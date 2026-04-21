# Architecture

## Overview

Whisper Desktop is a cross-platform desktop application built on Electron. The UI is a React SPA bundled by Vite. All speech recognition runs locally using `@xenova/transformers` (Whisper via ONNX) inside a Web Worker — no backend or internet connection required for inference after the model is downloaded.

## Execution Modes

| Mode | Command | How it runs |
|---|---|---|
| Browser (dev) | `npm run dev` | Vite serves on `localhost:5173` |
| Electron (dev) | `npm run electron:dev` | Vite on `5174` + Electron loads from it |
| Electron (prod) | `npm run electron:build` | Vite builds `dist/`, Electron loads `dist/index.html` |

## Directory Structure

```
whisper-desktop/
├── electron/
│   └── main.cjs          # Electron main process (CommonJS)
├── public/               # Static assets served as-is
├── src/
│   ├── App.tsx           # Root component
│   ├── index.tsx         # React entry point
│   ├── worker.js         # Web Worker — runs Whisper model off main thread
│   ├── components/
│   │   ├── AudioManager.tsx    # Orchestrates audio input sources
│   │   ├── AudioPlayer.tsx     # Plays back loaded audio
│   │   ├── AudioRecorder.tsx   # Microphone recording
│   │   ├── TranscribeButton.tsx
│   │   ├── Transcript.tsx      # Displays transcription output
│   │   ├── Progress.tsx        # Model download progress bar
│   │   └── modal/
│   │       ├── Modal.tsx
│   │       └── UrlInput.tsx    # Load audio from URL
│   ├── hooks/
│   │   ├── useTranscriber.ts   # Transcription state, model config, worker communication
│   │   └── useWorker.ts        # Creates and manages the Web Worker instance
│   ├── utils/
│   │   ├── AudioUtils.ts       # Audio decoding and resampling to 16kHz
│   │   ├── BlobFix.ts          # Blob handling utility
│   │   └── Constants.ts        # Default model, language, sampling rate
│   └── css/
│       └── index.css           # Tailwind base styles
├── stubs/
│   └── sharp/                  # Stub to satisfy electron-builder's optional sharp dep
├── index.html                  # Vite HTML entry
├── vite.config.ts              # Vite config (base: './' for Electron compatibility)
├── tailwind.config.cjs
├── postcss.config.cjs
├── tsconfig.json
└── package.json
```

## Data Flow

```
User (mic / file / URL)
        ↓
  AudioManager.tsx
        ↓
  AudioUtils.ts       ← decode + resample to 16kHz Float32Array
        ↓
  useTranscriber.ts   ← posts message to Web Worker
        ↓
  worker.js           ← loads Whisper model via @xenova/transformers
                      ← runs inference (ONNX, off main thread)
        ↓ (postMessage back)
  useTranscriber.ts   ← updates transcript state
        ↓
  Transcript.tsx      ← renders output with timestamps
```

## ML / Model Details

- Library: `@xenova/transformers` (Hugging Face Transformers.js)
- Default model: `Xenova/whisper-tiny` (configurable at runtime)
- Models are downloaded from Hugging Face on first use and cached automatically
- Inference runs entirely in a Web Worker to keep the UI responsive
- Audio must be 16000 Hz mono Float32Array before passing to the pipeline
- Supports multilingual mode, subtasks (transcribe / translate), and quantization

## Electron Integration

- `electron/main.cjs` is the main process entry point
- In **development**: loads `http://localhost:5174` (Vite dev server)
- In **production**: loads `dist/index.html` from disk
- `contextIsolation: true` is enabled; no `nodeIntegration`
- `vite.config.ts` sets `base: './'` so asset paths resolve correctly when loaded as a local file
