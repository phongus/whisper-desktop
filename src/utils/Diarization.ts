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
