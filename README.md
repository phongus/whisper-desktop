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

What is not shipped yet:
- Speaker diarization
- Polished cross-platform installers
- Production hardening for broad non-technical distribution

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
- No speaker labels yet

## Attribution

This project builds on the original whisper-web work by Xenova:
- Upstream project: https://github.com/xenova/whisper-web
- Transformers.js: https://github.com/xenova/transformers.js

The repository keeps the original MIT license and should be understood as a desktop adaptation of that foundation.
