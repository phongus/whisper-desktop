"""
Diarization runner for Whisper Desktop (Option A — pyannote.audio).

Usage:
    python diarize.py <audio_path> [--num-speakers N] [--min-speakers N] [--max-speakers N]
    python diarize.py --probe

Outputs JSON to stdout in the form:
    [
        {"start": 0.0, "end": 5.32, "speaker": "Speaker A"},
        ...
    ]

Environment:
    HUGGINGFACE_TOKEN  — Hugging Face access token (required for the gated
                         pyannote/speaker-diarization-3.1 model).
    PYANNOTE_PIPELINE  — Optional override; defaults to
                         "pyannote/speaker-diarization-3.1".

Logs go to stderr so stdout stays clean JSON for the Electron main process
to parse.
"""

import argparse
import json
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def speaker_label(idx: int) -> str:
    # Speaker 0 -> "Speaker A", 1 -> "Speaker B", ...
    return f"Speaker {chr(ord('A') + idx)}"


def probe() -> int:
    try:
        import pyannote.audio  # noqa: F401
        import torch  # noqa: F401
    except Exception as e:  # pylint: disable=broad-except
        log(f"probe failed: {e}")
        return 1
    return 0


def diarize(
    audio_path: str,
    num_speakers: int | None = None,
    min_speakers: int | None = None,
    max_speakers: int | None = None,
) -> int:
    if not os.path.isfile(audio_path):
        log(f"audio file not found: {audio_path}")
        return 2

    token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    if not token:
        log(
            "HUGGINGFACE_TOKEN env var is not set. Accept the model license "
            "at https://huggingface.co/pyannote/speaker-diarization-3.1 and "
            "create a read token at https://huggingface.co/settings/tokens."
        )
        return 3

    try:
        from pyannote.audio import Pipeline
    except Exception as e:  # pylint: disable=broad-except
        log(f"failed to import pyannote.audio: {e}")
        return 4

    pipeline_name = os.environ.get(
        "PYANNOTE_PIPELINE", "pyannote/speaker-diarization-3.1"
    )

    try:
        # pyannote.audio >=3.1 renamed `use_auth_token` to `token`. Try the
        # new kwarg first and fall back for older installs.
        try:
            pipeline = Pipeline.from_pretrained(pipeline_name, token=token)
        except TypeError:
            pipeline = Pipeline.from_pretrained(
                pipeline_name, use_auth_token=token
            )
    except Exception as e:  # pylint: disable=broad-except
        log(f"failed to load pipeline {pipeline_name}: {e}")
        return 5

    try:
        # pyannote 3.1 uses torchcodec for audio I/O, which requires FFmpeg
        # DLLs on Windows. Avoid that whole dependency chain by decoding the
        # WAV ourselves with soundfile and handing pyannote an in-memory
        # tensor dict (the documented workaround when torchcodec is missing).
        import numpy as np
        import soundfile as sf
        import torch

        data, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
        # soundfile returns (time, channel); pyannote wants (channel, time).
        waveform = torch.from_numpy(np.ascontiguousarray(data.T))
        # Pass speaker-count hints when provided; pyannote accepts either an
        # exact `num_speakers` or a `min_speakers`/`max_speakers` range.
        kwargs: dict = {}
        if num_speakers is not None:
            kwargs["num_speakers"] = num_speakers
        else:
            if min_speakers is not None:
                kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                kwargs["max_speakers"] = max_speakers
        log(f"running diarization with kwargs={kwargs}")
        diarization = pipeline(
            {"waveform": waveform, "sample_rate": sample_rate}, **kwargs
        )
    except Exception as e:  # pylint: disable=broad-except
        log(f"diarization failed: {e}")
        return 6

    # pyannote 4.x returns a DiarizeOutput wrapper; the actual Annotation is
    # exposed as .speaker_diarization. Older versions returned the Annotation
    # directly, which already has .itertracks.
    annotation = getattr(diarization, "speaker_diarization", diarization)

    # Map raw pyannote speaker IDs (e.g. "SPEAKER_00") to friendly labels in
    # order of first appearance.
    label_map: dict[str, str] = {}
    segments = []
    for turn, _track, raw_speaker in annotation.itertracks(yield_label=True):
        if raw_speaker not in label_map:
            label_map[raw_speaker] = speaker_label(len(label_map))
        segments.append(
            {
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": label_map[raw_speaker],
            }
        )

    json.dump(segments, sys.stdout)
    sys.stdout.flush()
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        log("usage: diarize.py <audio_path> [--num-speakers N] [--min-speakers N] [--max-speakers N] | --probe")
        return 64
    if args[0] == "--probe":
        return probe()

    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--num-speakers", type=int, default=None)
    parser.add_argument("--min-speakers", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=None)
    parsed = parser.parse_args(args)
    return diarize(
        parsed.audio_path,
        num_speakers=parsed.num_speakers,
        min_speakers=parsed.min_speakers,
        max_speakers=parsed.max_speakers,
    )


if __name__ == "__main__":
    sys.exit(main())
