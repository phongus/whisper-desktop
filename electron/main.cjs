const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Load .env so users can drop a file containing HUGGINGFACE_TOKEN next to the
// installed app (or in the repo root during development) without needing to
// set system environment variables. Search order:
//   1. Repo root (dev) / process.resourcesPath (packaged)
//   2. Directory containing the running .exe (packaged) — easiest for users
// Missing files are silently ignored.
(() => {
    const candidates = [];
    if (process.env.NODE_ENV === 'development') {
        candidates.push(path.join(__dirname, '..', '.env'));
    } else {
        // process.resourcesPath is only defined in packaged builds.
        if (process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, '.env'));
        }
        try {
            candidates.push(path.join(path.dirname(process.execPath), '.env'));
        } catch (_) {
            /* no-op */
        }
    }
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            require('dotenv').config({ path: p });
            console.log('[main] loaded .env from', p);
            break;
        }
    }
})();

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[main] preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, '../public/icon.png'),
        webPreferences: {
            contextIsolation: true,
            preload: preloadPath,
        },
        title: 'Whisper Desktop',
    });

    win.webContents.on('preload-error', (_event, p, error) => {
        console.error('[main] preload-error:', p, error);
    });

    if (isDev) {
        win.loadURL('http://localhost:5174');
    } else {
        win.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
    }
}

// --- Diarization (Option A: pyannote.audio via Python subprocess) -----------

function getPythonExecutable() {
    // Allow override via env var; default to "python" on PATH.
    return process.env.WHISPER_PYTHON || 'python';
}

function getDiarizeScriptPath() {
    // In dev, script lives at repo root under python/. In packaged builds,
    // ship it as an extraResource and resolve from process.resourcesPath.
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'python', 'diarize.py');
    }
    return path.join(__dirname, '..', 'python', 'diarize.py');
}

function runPython(args, stdinBuffer) {
    return new Promise((resolve, reject) => {
        const tag = `[py ${path.basename(args[0] || 'script')}]`;
        console.log(
            '[main] spawn python; HUGGINGFACE_TOKEN set:',
            !!process.env.HUGGINGFACE_TOKEN,
            'args:',
            args.slice(1).join(' '),
        );
        const proc = spawn(getPythonExecutable(), args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => {
            stdout += d.toString('utf8');
        });
        // Stream stderr as it arrives so the user can see pyannote's progress
        // (model download, inference) instead of waiting blind. Buffer per
        // line so partial chunks don't get logged with broken formatting.
        let stderrLineBuf = '';
        proc.stderr.on('data', (d) => {
            const text = d.toString('utf8');
            stderr += text;
            stderrLineBuf += text;
            let nl;
            while ((nl = stderrLineBuf.indexOf('\n')) !== -1) {
                const line = stderrLineBuf.slice(0, nl);
                stderrLineBuf = stderrLineBuf.slice(nl + 1);
                if (line.length > 0) console.log(tag, line);
            }
        });
        proc.on('error', (err) => {
            if (stderrLineBuf.length > 0) console.log(tag, stderrLineBuf);
            console.error('[main] python spawn error:', err.message);
            reject(err);
        });
        proc.on('close', (code) => {
            if (stderrLineBuf.length > 0) console.log(tag, stderrLineBuf);
            console.log(`[main] python exited ${code}`);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`python exited ${code}: ${stderr || stdout}`));
        });

        if (stdinBuffer) proc.stdin.end(stdinBuffer);
        else proc.stdin.end();
    });
}

ipcMain.handle('diarize:probe', async () => {
    try {
        await runPython([getDiarizeScriptPath(), '--probe']);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// --- Audio preprocessing (ffmpeg: highpass + denoise + loudness normalize) --

function getFfmpegPath() {
    // ffmpeg-static returns a path inside node_modules. In packaged builds
    // we configure electron-builder to extract that binary out of the asar
    // archive (asarUnpack), and rewrite the path here so it points into
    // app.asar.unpacked rather than the unreadable archive.
    let p;
    try {
        p = require('ffmpeg-static');
    } catch (_) {
        return null;
    }
    if (!p) return null;
    if (p.includes('app.asar')) {
        p = p.replace('app.asar', 'app.asar.unpacked');
    }
    return p;
}

ipcMain.handle('preprocess:probe', async () => {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        return { ok: false, error: 'ffmpeg binary not found' };
    }
    return { ok: true };
});

ipcMain.handle('preprocess', async (_event, wavBytes) => {
    if (!wavBytes || !(wavBytes instanceof Uint8Array || Buffer.isBuffer(wavBytes))) {
        throw new Error('preprocess: expected wav bytes');
    }
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) throw new Error('ffmpeg binary not available');

    const args = [
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-af', 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-23:LRA=7:TP=-2',
        '-ac', '1',
        '-ar', '16000',
        '-f', 'f32le',
        'pipe:1',
    ];

    return await new Promise((resolve, reject) => {
        console.log('[main] spawn ffmpeg for preprocess');
        const proc = spawn(ffmpegPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const chunks = [];
        let errBuf = '';
        proc.stdout.on('data', (d) => chunks.push(d));
        proc.stderr.on('data', (d) => {
            errBuf += d.toString('utf8');
        });
        proc.on('error', (err) => {
            console.error('[main] ffmpeg spawn error:', err.message);
            reject(err);
        });
        proc.on('close', (code) => {
            if (code === 0) {
                const out = Buffer.concat(chunks);
                console.log(
                    `[main] ffmpeg exited 0; produced ${out.length} bytes (${
                        out.length / 4
                    } samples)`,
                );
                // Return a fresh Uint8Array view so structured-clone over IPC
                // serializes only the audio bytes, not the underlying buffer.
                resolve(
                    new Uint8Array(
                        out.buffer.slice(
                            out.byteOffset,
                            out.byteOffset + out.byteLength,
                        ),
                    ),
                );
            } else {
                console.error(`[main] ffmpeg exited ${code}: ${errBuf.trim()}`);
                reject(new Error(`ffmpeg exited ${code}: ${errBuf.trim()}`));
            }
        });
        proc.stdin.end(Buffer.from(wavBytes));
    });
});

ipcMain.handle('diarize', async (_event, wavBytes, options) => {
    if (!wavBytes || !(wavBytes instanceof Uint8Array || Buffer.isBuffer(wavBytes))) {
        throw new Error('diarize: expected wav bytes');
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-diarize-'));
    const wavPath = path.join(tmpDir, `${crypto.randomUUID()}.wav`);

    try {
        fs.writeFileSync(wavPath, Buffer.from(wavBytes));
        const args = [getDiarizeScriptPath(), wavPath];
        if (options && typeof options === 'object') {
            if (Number.isInteger(options.numSpeakers)) {
                args.push('--num-speakers', String(options.numSpeakers));
            } else {
                if (Number.isInteger(options.minSpeakers)) {
                    args.push('--min-speakers', String(options.minSpeakers));
                }
                if (Number.isInteger(options.maxSpeakers)) {
                    args.push('--max-speakers', String(options.maxSpeakers));
                }
            }
        }
        const { stdout } = await runPython(args);
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
            throw new Error('diarize: python output was not an array');
        }
        return parsed;
    } finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
