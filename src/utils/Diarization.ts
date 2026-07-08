// Types and helpers for merging Whisper transcription chunks with speaker
// diarization segments. The merge logic is intentionally pure so it can be
// unit-tested and exercised against mock data before a real diarization
// backend (Option A — pyannote via Python subprocess) is wired up.

export interface WhisperChunk {
    text: string;
    timestamp: [number, number | null];
}

export interface SpeakerSegment {
    start: number;
    end: number;
    speaker: string;
}

export interface DiarizedSegment {
    start: number;
    end: number;
    speaker: string;
    text: string;
}

interface NormalizeSpeakerSegmentsOptions {
    maxMergeGapSeconds?: number;
    orphanTurnSeconds?: number;
}

const UNKNOWN_SPEAKER = "Unknown";

/**
 * Compute the overlap (in seconds) between two [start, end] intervals.
 */
function overlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number,
): number {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Assign a speaker to each Whisper chunk by finding the diarization segment
 * with the largest temporal overlap. If a chunk has no overlap with any
 * speaker segment (e.g. silence boundary), it falls back to "Unknown".
 *
 * Whisper sometimes emits a null end timestamp on the trailing chunk; in that
 * case we treat the end as the chunk's start (zero-width) which still allows
 * overlap matching against any segment that contains that instant.
 */
export function assignSpeakers(
    chunks: WhisperChunk[],
    segments: SpeakerSegment[],
): DiarizedSegment[] {
    return chunks.map((chunk) => {
        const start = chunk.timestamp[0] ?? 0;
        const end = chunk.timestamp[1] ?? start;

        let bestSpeaker = UNKNOWN_SPEAKER;
        let bestOverlap = 0;

        for (const seg of segments) {
            const ov = overlap(start, end, seg.start, seg.end);
            if (ov > bestOverlap) {
                bestOverlap = ov;
                bestSpeaker = seg.speaker;
            }
        }

        // Zero-width chunk: fall back to "contains start point" match.
        if (bestOverlap === 0 && end === start) {
            for (const seg of segments) {
                if (start >= seg.start && start <= seg.end) {
                    bestSpeaker = seg.speaker;
                    break;
                }
            }
        }

        return {
            start,
            end,
            speaker: bestSpeaker,
            text: chunk.text,
        };
    });
}

/**
 * Collapse consecutive diarized segments that share the same speaker into a
 * single segment with concatenated text. Useful for export formats where
 * per-chunk granularity is noise.
 */
export function groupBySpeaker(
    segments: DiarizedSegment[],
): DiarizedSegment[] {
    const grouped: DiarizedSegment[] = [];
    for (const seg of segments) {
        const last = grouped[grouped.length - 1];
        if (last && last.speaker === seg.speaker) {
            last.end = seg.end;
            last.text = `${last.text}${seg.text}`;
        } else {
            grouped.push({ ...seg });
        }
    }
    return grouped;
}

/**
 * Smooth diarization output so tiny turn flips do not dominate the final
 * transcript labeling. This primarily helps far-field meeting audio where
 * very short backchannels often get mislabeled.
 */
export function normalizeSpeakerSegments(
    segments: SpeakerSegment[],
    options: NormalizeSpeakerSegmentsOptions = {},
): SpeakerSegment[] {
    if (segments.length <= 1) return [...segments];

    const maxMergeGapSeconds = options.maxMergeGapSeconds ?? 0.2;
    const orphanTurnSeconds = options.orphanTurnSeconds ?? 0.9;

    const sorted = [...segments]
        .filter((s) => s.end > s.start)
        .sort((a, b) => a.start - b.start);

    if (sorted.length <= 1) return sorted;

    // First pass: merge same-speaker neighbors separated by tiny gaps.
    const merged: SpeakerSegment[] = [];
    for (const seg of sorted) {
        const last = merged[merged.length - 1];
        if (
            last &&
            last.speaker === seg.speaker &&
            seg.start - last.end <= maxMergeGapSeconds
        ) {
            last.end = Math.max(last.end, seg.end);
        } else {
            merged.push({ ...seg });
        }
    }

    // Second pass: absorb very short "orphan" turns sandwiched between the
    // same speaker on both sides (A-B-A where B is extremely short).
    for (let i = 1; i < merged.length - 1; i += 1) {
        const prev = merged[i - 1];
        const curr = merged[i];
        const next = merged[i + 1];
        const currDuration = curr.end - curr.start;

        if (
            currDuration <= orphanTurnSeconds &&
            prev.speaker === next.speaker &&
            curr.speaker !== prev.speaker
        ) {
            curr.speaker = prev.speaker;
        }
    }

    // Final pass: collapse adjacent entries with identical speaker labels.
    const flattened: SpeakerSegment[] = [];
    for (const seg of merged) {
        const last = flattened[flattened.length - 1];
        if (last && last.speaker === seg.speaker) {
            last.end = Math.max(last.end, seg.end);
        } else {
            flattened.push({ ...seg });
        }
    }

    return flattened;
}

/**
 * Generate mock speaker segments by alternating speakers across fixed-length
 * windows. Lets us exercise UI/export plumbing before a real diarization
 * model is integrated.
 */
export function mockSpeakerSegments(
    durationSeconds: number,
    options: { windowSeconds?: number; speakerCount?: number } = {},
): SpeakerSegment[] {
    const windowSeconds = options.windowSeconds ?? 8;
    const speakerCount = Math.max(1, options.speakerCount ?? 2);

    const segments: SpeakerSegment[] = [];
    let t = 0;
    let i = 0;
    while (t < durationSeconds) {
        const end = Math.min(t + windowSeconds, durationSeconds);
        segments.push({
            start: t,
            end,
            speaker: `Speaker ${String.fromCharCode(
                65 + (i % speakerCount),
            )}`,
        });
        t = end;
        i += 1;
    }
    return segments;
}
