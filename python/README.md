# Diarization (Option A — pyannote)

This folder ships the Python script the Electron main process spawns to run
speaker diarization with [pyannote.audio](https://github.com/pyannote/pyannote-audio).

## One-time setup

1. Install Python 3.10+ and ensure `python` is on your PATH (or set
   `WHISPER_PYTHON` to point at the executable, e.g. `py -3.11`).
2. Install dependencies:

    ```pwsh
    pip install -r python/requirements.txt
    ```

3. Accept the model licenses on Hugging Face (all three are required —
   pyannote 3.1 composes itself from several sub-models):
    - https://huggingface.co/pyannote/speaker-diarization-3.1
    - https://huggingface.co/pyannote/segmentation-3.0
    - https://huggingface.co/pyannote/speaker-diarization-community-1
4. Create a read token at https://huggingface.co/settings/tokens and export it
   before launching Electron:

    ```pwsh
    $env:HUGGINGFACE_TOKEN = "hf_xxx"
    npm run electron:dev
    ```

## Manual smoke test

```pwsh
python python/diarize.py path/to/audio.wav
```

The script prints a JSON array of `{ start, end, speaker }` segments to stdout.
All log/error output goes to stderr.

## Packaging note

For production builds, add this folder to `extraResources` in
`package.json`'s `build` block so the script is copied to
`process.resourcesPath/python/` alongside the installed app.
