// Preload script: exposes a narrow, typed API surface to the renderer over
// Electron's contextBridge. Keep this file CommonJS to match main.cjs.
const { contextBridge, ipcRenderer } = require('electron');

console.log('[preload] loaded; exposing window.api');

contextBridge.exposeInMainWorld('api', {
    /**
     * Run pyannote diarization on a WAV byte buffer. The renderer encodes
     * the audio to 16kHz mono 16-bit PCM WAV and hands the bytes to the
     * main process, which writes a temp file and invokes the Python script.
     * Returns an array of { start, end, speaker } segments.
     *
     * `options` may include `numSpeakers`, `minSpeakers`, `maxSpeakers` to
     * hint the diarization pipeline.
     */
    diarize: (wavBytes, options) =>
        ipcRenderer.invoke('diarize', wavBytes, options),

    /**
     * Probe whether the diarization backend is available on this machine
     * (Python found, dependencies importable). Returns { ok: boolean, error?: string }.
     */
    diarizeProbe: () => ipcRenderer.invoke('diarize:probe'),

    /**
     * Run an ffmpeg preprocessing pass on the given 16 kHz mono PCM WAV bytes
     * (high-pass + spectral denoise + loudness normalize). Returns raw f32le
     * bytes at 16 kHz mono, ready to be wrapped in a Float32Array.
     */
    preprocessAudio: (wavBytes) => ipcRenderer.invoke('preprocess', wavBytes),

    /** Probe whether ffmpeg is bundled and runnable. */
    preprocessProbe: () => ipcRenderer.invoke('preprocess:probe'),
});
