# Diarization Feature Plan

## Goal
Add speaker identification to Whisper Desktop so meeting transcripts include speaker labels, reducing the manual effort of feeding raw transcripts into Copilot for note generation.

**Target output:**
```json
[
  { "start": 0, "end": 8.2, "speaker": "Speaker A", "text": "Hey, sorry about that." },
  { "start": 28, "end": 30, "speaker": "Speaker B", "text": "No worries." }
]
```

---

## Option A — Python Subprocess (pyannote.audio)

### How it works
Electron spawns a Python process via `child_process`. Python runs pyannote.audio to produce speaker segments, which are merged with Whisper's text output by timestamp overlap.

### Steps
1. Accept pyannote model license on Hugging Face (one-time, free)
2. Install Python dependencies: `pyannote.audio`, `torch`
3. Write a Python script that takes an audio file path, runs diarization, and outputs JSON to stdout
4. In `electron/main.cjs`, add IPC handler to spawn the Python script via `child_process`
5. In the renderer, send audio file path to main process after Whisper finishes
6. Merge pyannote speaker segments with Whisper chunks by timestamp overlap
7. Update `Transcript.tsx` to display speaker labels
8. Update JSON/TXT export to include speaker fields

### Level of Effort
| Task | Effort |
|------|--------|
| Python diarization script | Low |
| Electron IPC wiring | Medium |
| Timestamp merge logic | Medium |
| UI updates | Low |
| Testing + tuning | Medium |
| **Total** | **~2–3 days** |

### Risks
| Risk | Likelihood | Impact |
|------|-----------|--------|
| Python not installed on target machine | High (non-dev users) | High |
| pyannote version breaking changes over time | Medium | Medium |
| HF license requirement blocks first-time setup | Low | Medium |
| Antivirus flagging subprocess execution | Low-Medium | High |
| Large PyTorch dependency (~2GB if not cached) | High | Medium |
| IPC communication errors / process crashes | Low | Medium |

### Best for
Personal/garage use where Python is already installed. Fast path to working diarization today.

---

## Option C — ONNX Model in Web Worker (Embedded)

### How it works
A pyannote-compatible ONNX model runs inside the existing Web Worker alongside Whisper. Both models process the same audio; results are merged by timestamp. Model is downloaded from Hugging Face on first run and cached locally — same pattern as Whisper today.

### Steps
1. Accept pyannote model license on Hugging Face (one-time, free)
2. Convert pyannote segmentation model to ONNX (Python script, run once by developer)
3. Upload converted model to Hugging Face hub (or self-host)
4. In `worker.js`, load ONNX model via `@xenova/transformers` after Whisper completes
5. Run speaker embedding + clustering on audio segments
6. Merge speaker segments with Whisper chunks by timestamp overlap
7. Update `Transcript.tsx` to display speaker labels
8. Update JSON/TXT export to include speaker fields

### Level of Effort
| Task | Effort |
|------|--------|
| ONNX model conversion (Python, one-time) | High — research required |
| Model hosting / verification | Medium |
| Web Worker integration | High — no existing reference implementation |
| Speaker clustering in JS | High — novel work |
| Timestamp merge logic | Medium |
| UI updates | Low |
| Testing + tuning | High |
| **Total** | **~1–3 weeks** (research-heavy) |

### Risks
| Risk | Likelihood | Impact |
|------|-----------|--------|
| No clean Transformers.js-compatible pyannote ONNX exists yet | High | High |
| ONNX conversion produces incorrect embeddings | Medium | High |
| Speaker clustering accuracy lower than pyannote Python pipeline | Medium | Medium |
| `@xenova/transformers` → `@huggingface/transformers` v3 migration needed eventually | Medium | Low |
| Longer initial model download (additional model on top of Whisper) | High | Low |
| Development time significantly longer than Option A | High | Medium |

### Best for
Learning, long-term product investment, fully self-contained distribution with no external dependencies.

---

## Comparison Summary

| Dimension | Option A | Option C |
|-----------|----------|----------|
| Works today | Yes | Partially |
| Requires Python on machine | Yes | No |
| Fully embedded in Electron | No | Yes |
| LOE | ~2–3 days | ~1–3 weeks |
| Long-term maintenance | Medium-High | Low |
| Learning value | Medium | High |
| Distribution complexity | High | Low |
| Accuracy | High (pyannote full pipeline) | TBD (depends on ONNX model quality) |

---

## Recommendation by Use Case

| Scenario | Recommended Option |
|----------|--------------------|
| Garage app, personal use, Python available | **Option A** |
| Learning project, deep dive | **Option C** |
| Commercial product, wide distribution | **Option C** (when mature) |
| Need it working this week | **Option A** |

---

## Shared Work (applies to both options)

Regardless of option chosen, the following work is the same:

- Timestamp merge algorithm (Whisper chunks + speaker segments)
- `Transcript.tsx` UI updates for speaker labels
- Export format changes (TXT and JSON)
- CHANGELOG update

This shared work is approximately **0.5–1 day** and can be built first against mock speaker data before the diarization model is integrated.

---

## Suggested Path

1. Build the shared timestamp merge + UI work against mock data
2. Implement Option A to get real diarization working quickly
3. Use the working app for actual meetings
4. Revisit Option C as a separate learning project when time permits
