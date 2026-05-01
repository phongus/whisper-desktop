import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorker } from "./useWorker";
import Constants from "../utils/Constants";
import {
    assignSpeakers,
    DiarizedSegment,
    SpeakerSegment,
} from "../utils/Diarization";
import { encodeWavMono16 } from "../utils/WavEncoder";

interface ProgressItem {
    file: string;
    loaded: number;
    progress: number;
    total: number;
    name: string;
    status: string;
}

interface TranscriberUpdateData {
    data: [
        string,
        { chunks: { text: string; timestamp: [number, number | null] }[] },
    ];
    text: string;
}

interface TranscriberCompleteData {
    data: {
        text: string;
        chunks: { text: string; timestamp: [number, number | null] }[];
        words?: { text: string; timestamp: [number, number | null] }[];
    };
}

export interface TranscriberData {
    isBusy: boolean;
    text: string;
    chunks: { text: string; timestamp: [number, number | null] }[];
    segments?: DiarizedSegment[];
    diarizationError?: string;
    /** True between transcription completion and diarization resolution. */
    diarizing?: boolean;
}

export type DiarizationStatus =
    | { state: "probing" }
    | { state: "available" }
    | { state: "unavailable"; reason: string };

export interface Transcriber {
    onInputChange: () => void;
    isBusy: boolean;
    isModelLoading: boolean;
    progressItems: ProgressItem[];
    start: (audioData: AudioBuffer | undefined) => void;
    output?: TranscriberData;
    model: string;
    setModel: (model: string) => void;
    multilingual: boolean;
    setMultilingual: (model: boolean) => void;
    quantized: boolean;
    setQuantized: (model: boolean) => void;
    subtask: string;
    setSubtask: (subtask: string) => void;
    language?: string;
    setLanguage: (language: string) => void;
    diarize: boolean;
    setDiarize: (diarize: boolean) => void;
    diarizationStatus: DiarizationStatus;
    /** 0 = auto-detect, otherwise an exact speaker count. */
    numSpeakers: number;
    setNumSpeakers: (n: number) => void;
    /** When true, route audio through ffmpeg denoise + loudness normalize before transcription. */
    cleanAudio: boolean;
    setCleanAudio: (clean: boolean) => void;
    cleanAudioAvailable: boolean;
}

export function useTranscriber(): Transcriber {
    const [transcript, setTranscript] = useState<TranscriberData | undefined>(
        undefined,
    );
    const [isBusy, setIsBusy] = useState(false);
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [diarize, setDiarize] = useState<boolean>(false);
    const [numSpeakers, setNumSpeakers] = useState<number>(0); // 0 = auto
    const [cleanAudio, setCleanAudio] = useState<boolean>(false);
    const [cleanAudioAvailable, setCleanAudioAvailable] =
        useState<boolean>(false);
    const [diarizationStatus, setDiarizationStatus] =
        useState<DiarizationStatus>(
            typeof window !== "undefined" && window.api
                ? { state: "probing" }
                : {
                      state: "unavailable",
                      reason:
                          "Diarization requires the Electron desktop build (run `npm run electron:dev`).",
                  },
        );

    // Probe the diarization backend once on mount so we can disable the
    // toggle / surface a clear reason instead of failing silently when the
    // user starts a long transcription.
    useEffect(() => {
        if (typeof window === "undefined" || !window.api) return;
        let cancelled = false;
        const probe = window.api
            .diarizeProbe()
            .then<DiarizationStatus>((res) => {
                const next: DiarizationStatus = res.ok
                    ? { state: "available" }
                    : {
                          state: "unavailable",
                          reason: res.error ?? "Unknown error",
                      };
                if (!cancelled) setDiarizationStatus(next);
                return next;
            })
            .catch<DiarizationStatus>((err) => {
                const reason =
                    err instanceof Error ? err.message : String(err);
                const next: DiarizationStatus = {
                    state: "unavailable",
                    reason,
                };
                if (!cancelled) setDiarizationStatus(next);
                return next;
            });
        probePromiseRef.current = probe;
        return () => {
            cancelled = true;
        };
    }, []);

    // Auto-disable the toggle if the backend turns out to be unavailable.
    useEffect(() => {
        if (diarizationStatus.state === "unavailable" && diarize) {
            setDiarize(false);
        }
    }, [diarizationStatus, diarize]);

    // Probe ffmpeg availability once on mount. Used to enable/disable the
    // "Clean up audio" toggle.
    useEffect(() => {
        if (typeof window === "undefined" || !window.api) return;
        let cancelled = false;
        window.api
            .preprocessProbe()
            .then((res) => {
                if (cancelled) return;
                setCleanAudioAvailable(!!res.ok);
                if (!res.ok) setCleanAudio(false);
            })
            .catch(() => {
                if (!cancelled) {
                    setCleanAudioAvailable(false);
                    setCleanAudio(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // The Web Worker message handler is registered once and captures these
    // values via closure. A ref keeps `diarize` current so the "complete"
    // handler reads the latest user choice instead of the initial render.
    const diarizeRef = useRef(diarize);
    // In-flight diarization promise started in parallel with transcription.
    // Resolved by the "complete" branch and merged with Whisper chunks.
    const diarizationPromiseRef = useRef<Promise<SpeakerSegment[]> | null>(
        null,
    );
    // Probe promise so postRequest can await an in-flight probe instead of
    // silently skipping diarization when the user hits Transcribe before the
    // initial probe finishes.
    const probePromiseRef = useRef<Promise<DiarizationStatus> | null>(null);
    useEffect(() => {
        diarizeRef.current = diarize;
    }, [diarize]);

    const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);

    const webWorker = useWorker((event) => {
        const message = event.data;
        // Update the state with the result
        switch (message.status) {
            case "progress":
                // Model file progress: update one of the progress items.
                setProgressItems((prev) =>
                    prev.map((item) => {
                        if (item.file === message.file) {
                            return { ...item, progress: message.progress };
                        }
                        return item;
                    }),
                );
                break;
            case "update":
                // Received partial update
                // console.log("update", message);
                // eslint-disable-next-line no-case-declarations
                const updateMessage = message as TranscriberUpdateData;
                setTranscript({
                    isBusy: true,
                    text: updateMessage.data[0],
                    chunks: updateMessage.data[1].chunks,
                });
                break;
            case "complete":
                // Received complete transcript
                // console.log("complete", message);
                // eslint-disable-next-line no-case-declarations
                const completeMessage = message as TranscriberCompleteData;
                // Render Whisper output immediately; diarization may resolve
                // later (or not at all if disabled / unavailable).
                // eslint-disable-next-line no-case-declarations
                const pendingDiarization =
                    diarizeRef.current && diarizationPromiseRef.current;
                setTranscript({
                    isBusy: false,
                    text: completeMessage.data.text,
                    chunks: completeMessage.data.chunks,
                    diarizing: !!pendingDiarization,
                });
                setIsBusy(false);

                if (diarizeRef.current) {
                    // eslint-disable-next-line no-case-declarations
                    const pending = diarizationPromiseRef.current;
                    diarizationPromiseRef.current = null;

                    if (pending) {
                        pending
                            .then((segs) => {
                                // Prefer word-level chunks for diarization
                                // assignment when available — they avoid the
                                // "sentence straddles two speakers" failure
                                // mode that hits coarse segment timestamps.
                                const sourceChunks =
                                    completeMessage.data.words &&
                                    completeMessage.data.words.length > 0
                                        ? completeMessage.data.words
                                        : completeMessage.data.chunks;
                                const merged = assignSpeakers(
                                    sourceChunks,
                                    segs,
                                );
                                setTranscript((prev) =>
                                    prev
                                        ? {
                                              ...prev,
                                              segments: merged,
                                              diarizing: false,
                                          }
                                        : prev,
                                );
                            })
                            .catch((err) => {
                                const reason =
                                    err instanceof Error
                                        ? err.message
                                        : String(err);
                                console.error(
                                    "Diarization failed:",
                                    reason,
                                );
                                setTranscript((prev) =>
                                    prev
                                        ? {
                                              ...prev,
                                              diarizationError: reason,
                                              diarizing: false,
                                          }
                                        : prev,
                                );
                                setDiarizationStatus({
                                    state: "unavailable",
                                    reason,
                                });
                            });
                    }
                }
                break;

            case "initiate":
                // Model file start load: add a new progress item to the list.
                setIsModelLoading(true);
                setProgressItems((prev) => [...prev, message]);
                break;
            case "ready":
                setIsModelLoading(false);
                break;
            case "error":
                setIsBusy(false);
                alert(
                    `${message.data.message} This is most likely because you are using Safari on an M1/M2 Mac. Please try again from Chrome, Firefox, or Edge.\n\nIf this is not the case, please file a bug report.`,
                );
                break;
            case "done":
                // Model file loaded: remove the progress item from the list.
                setProgressItems((prev) =>
                    prev.filter((item) => item.file !== message.file),
                );
                break;

            default:
                // initiate/download/done
                break;
        }
    });

    const [model, setModel] = useState<string>(Constants.DEFAULT_MODEL);
    const [subtask, setSubtask] = useState<string>(Constants.DEFAULT_SUBTASK);
    const [quantized, setQuantized] = useState<boolean>(
        Constants.DEFAULT_QUANTIZED,
    );
    const [multilingual, setMultilingual] = useState<boolean>(
        Constants.DEFAULT_MULTILINGUAL,
    );
    const [language, setLanguage] = useState<string>(
        Constants.DEFAULT_LANGUAGE,
    );

    const onInputChange = useCallback(() => {
        setTranscript(undefined);
    }, []);

    const postRequest = useCallback(
        async (audioData: AudioBuffer | undefined) => {
            if (audioData) {
                setTranscript(undefined);
                setIsBusy(true);

                let audio;
                if (audioData.numberOfChannels === 2) {
                    const SCALING_FACTOR = Math.sqrt(2);

                    let left = audioData.getChannelData(0);
                    let right = audioData.getChannelData(1);

                    audio = new Float32Array(left.length);
                    for (let i = 0; i < audioData.length; ++i) {
                        audio[i] = SCALING_FACTOR * (left[i] + right[i]) / 2;
                    }
                } else {
                    // If the audio is not stereo, we can just use the first channel:
                    audio = audioData.getChannelData(0);
                }

                // Optional: route audio through ffmpeg for high-pass +
                // spectral denoise + loudness normalize before either model
                // sees it. Failure here falls back to the original samples
                // so a broken ffmpeg never blocks transcription.
                if (
                    cleanAudio &&
                    cleanAudioAvailable &&
                    typeof window !== "undefined" &&
                    window.api
                ) {
                    try {
                        const wavIn = encodeWavMono16(
                            audio,
                            Constants.SAMPLING_RATE,
                        );
                        const cleanedBytes =
                            await window.api.preprocessAudio(wavIn);
                        // ffmpeg returned f32le bytes; wrap as Float32Array.
                        // Copy to ensure proper alignment of the underlying
                        // ArrayBuffer.
                        const aligned = new ArrayBuffer(
                            cleanedBytes.byteLength,
                        );
                        new Uint8Array(aligned).set(cleanedBytes);
                        audio = new Float32Array(aligned);
                    } catch (err) {
                        console.error(
                            "Audio preprocessing failed; falling back to raw audio:",
                            err,
                        );
                    }
                }

                // Kick off real diarization in parallel with transcription.
                // Only attempt it when the probe says the backend is
                // available; otherwise leave null and the "complete" handler
                // will simply render Whisper output without speaker labels.
                //
                // If the probe is still running when the user hits
                // Transcribe, await it here so we don't silently skip
                // diarization on a fast double-click after launch.
                let resolvedDiarizationStatus = diarizationStatus;
                if (
                    diarize &&
                    diarizationStatus.state === "probing" &&
                    probePromiseRef.current
                ) {
                    try {
                        resolvedDiarizationStatus =
                            await probePromiseRef.current;
                    } catch {
                        resolvedDiarizationStatus = {
                            state: "unavailable",
                            reason: "Probe failed",
                        };
                    }
                }

                if (
                    diarize &&
                    resolvedDiarizationStatus.state === "available" &&
                    typeof window !== "undefined" &&
                    window.api
                ) {
                    try {
                        const wav = encodeWavMono16(
                            audio,
                            Constants.SAMPLING_RATE,
                        );
                        const opts: { numSpeakers?: number } = {};
                        if (numSpeakers > 0) opts.numSpeakers = numSpeakers;
                        diarizationPromiseRef.current =
                            window.api.diarize(wav, opts);
                    } catch (err) {
                        console.error("Failed to start diarization:", err);
                        diarizationPromiseRef.current = null;
                    }
                } else {
                    diarizationPromiseRef.current = null;
                }

                webWorker.postMessage({
                    audio,
                    model,
                    multilingual,
                    quantized,
                    subtask: multilingual ? subtask : null,
                    language:
                        multilingual && language !== "auto" ? language : null,
                });
            }
        },
        [webWorker, model, multilingual, quantized, subtask, language, diarize, diarizationStatus, numSpeakers, cleanAudio, cleanAudioAvailable],
    );

    const transcriber = useMemo(() => {
        return {
            onInputChange,
            isBusy,
            isModelLoading,
            progressItems,
            start: postRequest,
            output: transcript,
            model,
            setModel,
            multilingual,
            setMultilingual,
            quantized,
            setQuantized,
            subtask,
            setSubtask,
            language,
            setLanguage,
            diarize,
            setDiarize,
            diarizationStatus,
            numSpeakers,
            setNumSpeakers,
            cleanAudio,
            setCleanAudio,
            cleanAudioAvailable,
        };
    }, [
        isBusy,
        isModelLoading,
        progressItems,
        postRequest,
        transcript,
        model,
        multilingual,
        quantized,
        subtask,
        language,
        diarize,
        diarizationStatus,
        numSpeakers,
        cleanAudio,
        cleanAudioAvailable,
    ]);

    return transcriber;
}
