// eslint-disable-next-line spaced-comment
/// <reference types="vite/client" />

import type { SpeakerSegment } from "./utils/Diarization";

declare global {
    interface Window {
        // Exposed by electron/preload.cjs when running inside Electron. Will be
        // undefined when the app is served as a plain browser SPA.
        api?: {
            diarize: (
                wavBytes: Uint8Array,
                options?: {
                    numSpeakers?: number;
                    minSpeakers?: number;
                    maxSpeakers?: number;
                },
            ) => Promise<SpeakerSegment[]>;
            diarizeProbe: () => Promise<{ ok: boolean; error?: string }>;
            preprocessAudio: (wavBytes: Uint8Array) => Promise<Uint8Array>;
            preprocessProbe: () => Promise<{ ok: boolean; error?: string }>;
        };
    }
}

export {};
