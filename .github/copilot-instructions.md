# Copilot Instructions

## Project Overview
Whisper Desktop is an Electron + Vite + React + TypeScript desktop application that runs OpenAI Whisper speech recognition locally using Transformers.js (`@xenova/transformers`). All ML inference runs in a Web Worker — no server required.

## Stack
- **Electron** `^41` — desktop shell (`electron/main.cjs`)
- **Vite** `^4` — bundler and dev server
- **React** `^18` + **TypeScript** `^4.9`
- **Tailwind CSS** `^3` — utility-first styling
- **@xenova/transformers** `^2.7` — runs Whisper model in-browser via ONNX
- **Headless UI** — accessible UI primitives
- **ESLint** + **Prettier** — linting and formatting

## Project Conventions
- Use TypeScript for all source files under `src/`
- Tailwind utility classes for all styling — no separate CSS files except `src/css/index.css`
- Components live in `src/components/`, hooks in `src/hooks/`, utilities in `src/utils/`
- The ML worker is `src/worker.js` — it runs `@xenova/transformers` off the main thread
- `electron/main.cjs` is CommonJS (`.cjs`) — do not use ESM syntax there
- `vite.config.ts` uses `base: './'` — required for Electron to load built files from disk

## Run Commands
- `npm run dev` — Vite dev server only (browser)
- `npm run electron:dev` — Vite on port 5174 + Electron (development)
- `npm run electron:build` — production build + Windows installer via electron-builder
- `npm run build` — Vite build only
- `npm run lint` — ESLint
- `npm run format` — Prettier

## Key Files
- `electron/main.cjs` — Electron main process; loads `localhost:5174` in dev, `dist/index.html` in prod
- `src/worker.js` — Web Worker that loads and runs the Whisper model
- `src/hooks/useTranscriber.ts` — main transcription state and logic
- `src/hooks/useWorker.ts` — creates and manages the Web Worker
- `src/utils/Constants.ts` — default model, language, sampling rate settings
- `src/components/AudioManager.tsx` — handles audio input (mic + file + URL)

## Important Notes
- Audio must be resampled to 16000 Hz before passing to the worker (see `AudioUtils.ts`)
- Model files are downloaded from Hugging Face on first use and cached in the browser
- Default model is `Xenova/whisper-tiny` — configurable at runtime
- `stubs/sharp/` exists to satisfy electron-builder's optional `sharp` dependency — do not remove
