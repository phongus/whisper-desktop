# Whisper Desktop

Whisper Desktop is an Electron + React desktop app for local speech transcription with Whisper running through Transformers.js in a Web Worker.

It is derived from Xenova's whisper-web project and adapts that browser-first implementation into a desktop workflow with Electron packaging, file input, microphone recording, and local model execution.

## Status

This project is usable, but it should be treated as an early public alpha.

What works today:
- Local transcription in a desktop app
- Audio input from file, URL, or microphone recording
- Model download and caching through Hugging Face
- Transcript export as TXT and JSON
- Speaker diarization via pyannote.audio (Python sidecar) with optional speaker-count hint and word-level speaker assignment
- Inline rename / reassign / add-speaker controls in the transcript view

What is not shipped yet:
- Polished cross-platform installers
- Production hardening for broad non-technical distribution
- Persistence of speaker names across sessions or files

## Current platform support

The packaged installer is currently Windows-first. The development setup should still run anywhere Electron and Node are supported, but the release flow in this repository is aimed at Windows builds.

## Quick start

### Development

```bash
npm install
npm run electron:dev
```

This starts Vite on port 5174 and launches Electron against the dev server.

### Production build

```bash
npm install
npm run electron:build
```

This builds the renderer and creates a Windows installer with electron-builder.

## How it works

- React renders the desktop UI
- Vite builds the renderer
- Electron hosts the app shell
- A Web Worker loads Whisper via `@xenova/transformers`
- Audio is resampled to 16 kHz before inference
- Model files are downloaded on first use and then cached locally

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the implementation overview.

## Limitations

- First run may take time because Whisper model files need to be downloaded
- Performance depends heavily on local CPU and available system resources
- Large audio files can take noticeable time to decode and transcribe
- Diarization runs on CPU via Python (pyannote.audio) and roughly takes 0.3–1× the audio length after the first run; the pyannote model (~500 MB) is downloaded into the Hugging Face cache on first use

## What's new in 1.2.0

- **Audio cleanup pass**: optional ffmpeg-based high-pass + spectral denoise + loudness-normalize step that runs before both Whisper and pyannote see the audio. Toggle in Settings; helps noisy phone/laptop-mic recordings. ffmpeg is now bundled with the installer.
- **Inline rename / reassign / add-speaker** controls in the transcript view (carried over from 1.1.2). Click a speaker name to rename them everywhere; click the ▼ to reassign just one line; pick "+ Add new speaker" when pyannote merged two real people.
- **Word-level diarization assignment** (carried over from 1.1.1) — speaker labels are derived from per-word Whisper timestamps instead of coarse sentence chunks, fixing boundary mis-attributions.
- **Number of speakers** dropdown in Settings; setting an exact count (e.g. `2`) noticeably improves accuracy.
- **Probe-race fix**: hitting Transcribe immediately after launch no longer silently skips diarization while the Python backend is still warming up. The transcribe request now awaits the probe.
- **Python stderr is streamed** to the main process console with a `[py …]` prefix so model-download / inference progress is visible while pyannote runs.
- **`.env` loading** at startup (carried over from 1.1.1): drop a file containing `HUGGINGFACE_TOKEN=…` next to the installed `.exe` (or in the repo root in dev) and it gets picked up automatically.

## What's new in 1.1.2

- **Rename a speaker everywhere**: click the speaker label (e.g. `Speaker A`) above any line to rename them (e.g. “Alex”). Every line tagged with that speaker updates instantly. Press Enter to save, Escape to cancel.
- **Reassign a single line**: click the small ▼ next to a speaker label to change just that one line to a different speaker. Useful when diarization mis-attributes a sentence at a speaker boundary.
- **Add a new speaker**: from the reassign menu, choose “+ Add new speaker” when pyannote merged two real speakers into one. The new speaker can then be renamed like any other.
- Renames and reassignments are reflected in the TXT and JSON exports.
- Edits live for the current transcript only; starting a new transcription resets them.

## What's new in 1.1.1

- Added a **Number of speakers** dropdown in Settings (visible when “Diarize speakers” is enabled). Set it to the exact count (e.g. `2` for an interview) to noticeably improve speaker accuracy; leave on `Auto` to let pyannote decide.
- Diarization now assigns speakers using **word-level Whisper timestamps**, which fixes the common case where a sentence straddling two speakers got attributed to the wrong person.
- The transcript view now shows an **“Identifying speakers…”** indicator while pyannote is still running after Whisper has finished, so it no longer looks like the app is idle.
- A `.env` file dropped next to the installed `.exe` (or in the repo root in dev) is now loaded at startup, so users can supply `HUGGINGFACE_TOKEN` without setting a system environment variable.

## Attribution

This project builds on the original whisper-web work by Xenova:
- Upstream project: https://github.com/xenova/whisper-web
- Transformers.js: https://github.com/xenova/transformers.js

The repository keeps the original MIT license and should be understood as a desktop adaptation of that foundation.
