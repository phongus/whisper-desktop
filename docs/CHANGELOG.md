# Changelog

All notable changes to Whisper Desktop will be documented here.

## [Unreleased]
### Added
- Diarization scaffolding (Phase 1 — shared work):
  - `src/utils/Diarization.ts` with `assignSpeakers`, `groupBySpeaker`, and `mockSpeakerSegments` helpers
  - `TranscriberData.segments` field carrying speaker-labeled segments
  - "Diarize (mock)" toggle in the Settings modal that synthesizes alternating speakers post-transcription
  - Speaker labels rendered in the transcript view when diarization is enabled
  - TXT and JSON exports include speaker labels when diarization is enabled
- Real diarization (Phase 2 — Option A: pyannote via Electron IPC):
  - `electron/preload.cjs` exposes `window.api.diarize` / `window.api.diarizeProbe` over `contextBridge`
  - `electron/main.cjs` registers `diarize` / `diarize:probe` IPC handlers that spawn `python python/diarize.py`
  - `python/diarize.py` runs `pyannote/speaker-diarization-3.1` and emits `[{ start, end, speaker }]` JSON on stdout
  - `python/requirements.txt` and `python/README.md` document one-time setup (HF token + pip install)
  - Renderer encodes the resampled mono Float32 buffer to 16-bit PCM WAV (`src/utils/WavEncoder.ts`) and runs diarization in parallel with Whisper inference
  - Falls back to mock segments if `window.api` is unavailable (browser dev mode) or the Python pipeline fails
  - Production builds copy `python/` to `process.resourcesPath/python/` via electron-builder `extraResources`
- Diarization availability handling:
  - Probes the Python backend on startup via `window.api.diarizeProbe`
  - Exposes `Transcriber.diarizationStatus` (`probing` | `available` | `unavailable` with reason)
  - Settings toggle is disabled (with tooltip + reason) when the backend is unavailable
  - Removed the silent mock fallback on per-run failures; instead the transcript now surfaces an inline warning containing the actual error

## [1.0.4] - 2026-04-21
### Changed
- Rewrote the README for Whisper Desktop instead of the upstream whisper-web browser demo
- Marked the repository metadata as public-facing for an alpha GitHub release
- Tightened in-app copy to describe the desktop app more clearly

## [1.0.3] - 2026-04-18
### Changed
- Updated front page subtitle to say "Desktop" instead of "browser"

## [1.0.2] - 2026-04-18
### Changed
- Updated application icons
- Changed window title to "Whisper Desktop"
- Tentative icon sourced from Google Fonts

## [1.0.1] - 2026-04-18
### Fixed
- Working UI — product transcription pipeline functional

## [1.0.0] - 2026-04-18
### Added
- Initial build converting Whisper Web to an Electron desktop app
- Known issue: broken UI
