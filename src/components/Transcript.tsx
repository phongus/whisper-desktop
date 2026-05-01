import { useRef, useEffect, useState, useMemo } from "react";

import { TranscriberData } from "../hooks/useTranscriber";
import { formatAudioTimestamp } from "../utils/AudioUtils";
import {
    DiarizedSegment,
    groupBySpeaker,
    SpeakerSegment,
} from "../utils/Diarization";

interface Props {
    transcribedData: TranscriberData | undefined;
}

type EditingState =
    | null
    | { kind: "rename"; speakerId: string; rowIndex: number }
    | { kind: "reassign"; segmentIndex: number };

/**
 * Generate the next unused "Speaker X" label given a set of taken IDs.
 */
function nextSpeakerId(taken: Set<string>): string {
    for (let i = 0; i < 26; i++) {
        const id = `Speaker ${String.fromCharCode(65 + i)}`;
        if (!taken.has(id)) return id;
    }
    return `Speaker ${taken.size + 1}`;
}

export default function Transcript({ transcribedData }: Props) {
    const divRef = useRef<HTMLDivElement>(null);

    // Source segments from the transcriber (immutable). Edits live in local
    // state below as overrides + name map; we never mutate the underlying
    // diarization output.
    const segments = transcribedData?.segments;

    // Map of original speaker ID -> user-chosen display name (e.g. "Alex").
    const [nameMap, setNameMap] = useState<Record<string, string>>({});
    // Per-segment speaker override (segment index -> speaker ID). Used when
    // the user reassigns a misattributed line to a different speaker.
    const [overrides, setOverrides] = useState<Record<number, string>>({});
    // Speaker IDs the user added manually (when pyannote missed someone).
    const [extraSpeakers, setExtraSpeakers] = useState<string[]>([]);
    // Currently open inline editor, if any.
    const [editing, setEditing] = useState<EditingState>(null);
    // Draft text for the rename input.
    const [renameDraft, setRenameDraft] = useState("");

    // Reset all per-transcript edits when the segments reference changes
    // (i.e. a new transcription started). Same audio re-rendered = same
    // reference, so user edits stick during the "Identifying speakers…"
    // phase that swaps in segments after the fact.
    const segmentsRef = useRef<DiarizedSegment[] | undefined>(undefined);
    useEffect(() => {
        if (segmentsRef.current !== segments) {
            segmentsRef.current = segments;
            setNameMap({});
            setOverrides({});
            setExtraSpeakers([]);
            setEditing(null);
        }
    }, [segments]);

    // All speaker IDs known to this transcript (from diarization + manually
    // added). Used to populate the reassign menu.
    const allSpeakerIds = useMemo(() => {
        const set = new Set<string>();
        segments?.forEach((s) => set.add(s.speaker));
        extraSpeakers.forEach((id) => set.add(id));
        return Array.from(set);
    }, [segments, extraSpeakers]);

    const displayName = (id: string) => nameMap[id] ?? id;

    /** Apply overrides to produce the rendered/exported segments. */
    const effectiveSegments = useMemo<DiarizedSegment[]>(() => {
        if (!segments) return [];
        return segments.map((s, i) => ({
            ...s,
            speaker: overrides[i] ?? s.speaker,
        }));
    }, [segments, overrides]);

    /** Same segments but with display names baked in (used on export). */
    const exportSegments = useMemo<SpeakerSegment[] & DiarizedSegment[]>(() => {
        return effectiveSegments.map((s) => ({
            ...s,
            speaker: displayName(s.speaker),
        }));
        // displayName depends on nameMap; effectiveSegments depends on segments+overrides.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveSegments, nameMap]);

    const saveBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };
    const exportTXT = () => {
        let text: string;
        if (exportSegments.length > 0) {
            text = groupBySpeaker(exportSegments)
                .map((s) => `[${s.speaker}] ${s.text.trim()}`)
                .join("\n");
        } else {
            const chunks = transcribedData?.chunks ?? [];
            text = chunks
                .map((chunk) => chunk.text)
                .join("")
                .trim();
        }

        const blob = new Blob([text], { type: "text/plain" });
        saveBlob(blob, "transcript.txt");
    };
    const exportJSON = () => {
        let jsonData: string;
        if (exportSegments.length > 0) {
            jsonData = JSON.stringify(groupBySpeaker(exportSegments), null, 2);
        } else {
            jsonData = JSON.stringify(transcribedData?.chunks ?? [], null, 2);
            // post-process the JSON to make it more readable
            const regex = /(    "timestamp": )\[\s+(\S+)\s+(\S+)\s+\]/gm;
            jsonData = jsonData.replace(regex, "$1[$2 $3]");
        }

        const blob = new Blob([jsonData], { type: "application/json" });
        saveBlob(blob, "transcript.json");
    };

    // Scroll to the bottom when the component updates
    useEffect(() => {
        if (divRef.current) {
            const diff = Math.abs(
                divRef.current.offsetHeight +
                    divRef.current.scrollTop -
                    divRef.current.scrollHeight,
            );

            if (diff <= 64) {
                // We're close enough to the bottom, so scroll to the bottom
                divRef.current.scrollTop = divRef.current.scrollHeight;
            }
        }
    });

    const hasSpeakers =
        !!effectiveSegments && effectiveSegments.length > 0;

    const openRename = (speakerId: string, rowIndex: number) => {
        setRenameDraft(displayName(speakerId));
        setEditing({ kind: "rename", speakerId, rowIndex });
    };

    const commitRename = () => {
        if (editing?.kind !== "rename") return;
        const trimmed = renameDraft.trim();
        setNameMap((prev) => {
            const next = { ...prev };
            if (!trimmed || trimmed === editing.speakerId) {
                delete next[editing.speakerId];
            } else {
                next[editing.speakerId] = trimmed;
            }
            return next;
        });
        setEditing(null);
    };

    const reassignSegment = (segmentIndex: number, newSpeakerId: string) => {
        setOverrides((prev) => {
            const next = { ...prev };
            const original = segments?.[segmentIndex]?.speaker;
            if (original === newSpeakerId) {
                delete next[segmentIndex];
            } else {
                next[segmentIndex] = newSpeakerId;
            }
            return next;
        });
        setEditing(null);
    };

    const addAndAssignNewSpeaker = (segmentIndex: number) => {
        const taken = new Set(allSpeakerIds);
        const id = nextSpeakerId(taken);
        setExtraSpeakers((prev) => [...prev, id]);
        setOverrides((prev) => ({ ...prev, [segmentIndex]: id }));
        setEditing(null);
    };


    return (
        <div
            ref={divRef}
            className='w-full flex flex-col my-2 p-4 max-h-[20rem] overflow-y-auto'
        >
            {transcribedData?.diarizationError && (
                <div
                    className='w-full mb-2 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm ring-1 ring-amber-300'
                    role='alert'
                >
                    <strong>Speaker labels unavailable.</strong>{" "}
                    {transcribedData.diarizationError}
                </div>
            )}
            {transcribedData?.diarizing && (
                <div
                    className='w-full mb-2 bg-blue-50 text-blue-900 rounded-lg p-3 text-sm ring-1 ring-blue-300 flex items-center'
                    role='status'
                    aria-live='polite'
                >
                    <svg
                        className='animate-spin h-4 w-4 mr-2 text-blue-700'
                        xmlns='http://www.w3.org/2000/svg'
                        fill='none'
                        viewBox='0 0 24 24'
                    >
                        <circle
                            className='opacity-25'
                            cx='12'
                            cy='12'
                            r='10'
                            stroke='currentColor'
                            strokeWidth='4'
                        ></circle>
                        <path
                            className='opacity-75'
                            fill='currentColor'
                            d='M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z'
                        ></path>
                    </svg>
                    Identifying speakers… (this may take a while on long audio)
                </div>
            )}
            {hasSpeakers
                ? effectiveSegments.map((seg, i) => {
                      const isRenaming =
                          editing?.kind === "rename" &&
                          editing.speakerId === seg.speaker &&
                          editing.rowIndex === i;
                      const isReassigning =
                          editing?.kind === "reassign" &&
                          editing.segmentIndex === i;
                      return (
                          <div
                              key={`${i}-${seg.text}`}
                              className='w-full flex flex-col mb-2 bg-white rounded-lg p-4 shadow-xl shadow-black/5 ring-1 ring-slate-700/10'
                          >
                              <div className='flex flex-row items-start'>
                                  <div className='mr-5 tabular-nums'>
                                      {formatAudioTimestamp(seg.start)}
                                  </div>
                                  <div className='mr-3 flex items-center whitespace-nowrap'>
                                      {isRenaming ? (
                                          <>
                                              <input
                                                  autoFocus
                                                  className='border border-slate-300 rounded px-1 py-0.5 text-sm font-semibold w-32'
                                                  value={renameDraft}
                                                  onChange={(e) =>
                                                      setRenameDraft(
                                                          e.target.value,
                                                      )
                                                  }
                                                  onKeyDown={(e) => {
                                                      if (e.key === "Enter")
                                                          commitRename();
                                                      else if (
                                                          e.key === "Escape"
                                                      )
                                                          setEditing(null);
                                                  }}
                                                  onBlur={commitRename}
                                              />
                                              <button
                                                  type='button'
                                                  className='ml-1 text-xs text-slate-500 hover:text-slate-700'
                                                  onMouseDown={(e) =>
                                                      e.preventDefault()
                                                  }
                                                  onClick={() =>
                                                      setEditing(null)
                                                  }
                                                  title='Cancel'
                                              >
                                                  ✕
                                              </button>
                                          </>
                                      ) : (
                                          <>
                                              <button
                                                  type='button'
                                                  className='font-semibold text-slate-700 hover:text-blue-600 hover:underline focus:outline-none focus:underline'
                                                  onClick={() =>
                                                      openRename(
                                                          seg.speaker,
                                                          i,
                                                      )
                                                  }
                                                  title='Rename this speaker everywhere'
                                              >
                                                  {displayName(seg.speaker)}
                                              </button>
                                              <button
                                                  type='button'
                                                  className='ml-1 text-slate-400 hover:text-slate-700 text-xs px-1'
                                                  onClick={() =>
                                                      setEditing(
                                                          isReassigning
                                                              ? null
                                                              : {
                                                                    kind: "reassign",
                                                                    segmentIndex:
                                                                        i,
                                                                },
                                                      )
                                                  }
                                                  title='Reassign just this line to a different speaker'
                                                  aria-label='Reassign this line'
                                              >
                                                  ▼
                                              </button>
                                          </>
                                      )}
                                  </div>
                                  <div className='flex-1'>{seg.text}</div>
                              </div>
                              {isReassigning && (
                                  <div
                                      className='mt-2 ml-16 p-2 bg-slate-50 rounded ring-1 ring-slate-200 text-sm'
                                      role='menu'
                                  >
                                      <div className='text-slate-500 mb-1'>
                                          This line was spoken by:
                                      </div>
                                      {allSpeakerIds.map((id) => {
                                          const isCurrent =
                                              id === seg.speaker;
                                          return (
                                              <button
                                                  key={id}
                                                  type='button'
                                                  className={`block w-full text-left px-2 py-1 rounded hover:bg-blue-100 ${
                                                      isCurrent
                                                          ? "bg-blue-50 font-semibold"
                                                          : ""
                                                  }`}
                                                  onClick={() =>
                                                      reassignSegment(i, id)
                                                  }
                                              >
                                                  {isCurrent ? "● " : "○ "}
                                                  {displayName(id)}
                                                  {displayName(id) !== id && (
                                                      <span className='text-xs text-slate-400 ml-1'>
                                                          ({id})
                                                      </span>
                                                  )}
                                              </button>
                                          );
                                      })}
                                      <button
                                          type='button'
                                          className='block w-full text-left px-2 py-1 rounded hover:bg-blue-100 text-blue-600'
                                          onClick={() =>
                                              addAndAssignNewSpeaker(i)
                                          }
                                      >
                                          + Add new speaker
                                      </button>
                                  </div>
                              )}
                          </div>
                      );
                  })
                : transcribedData?.chunks &&
                  transcribedData.chunks.map((chunk, i) => (
                      <div
                          key={`${i}-${chunk.text}`}
                          className='w-full flex flex-row mb-2 bg-white rounded-lg p-4 shadow-xl shadow-black/5 ring-1 ring-slate-700/10'
                      >
                          <div className='mr-5'>
                              {formatAudioTimestamp(chunk.timestamp[0])}
                          </div>
                          {chunk.text}
                      </div>
                  ))}
            {transcribedData && !transcribedData.isBusy && (
                <div className='w-full text-right'>
                    <button
                        onClick={exportTXT}
                        className='text-white bg-green-500 hover:bg-green-600 focus:ring-4 focus:ring-green-300 font-medium rounded-lg text-sm px-4 py-2 text-center mr-2 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800 inline-flex items-center'
                    >
                        Export TXT
                    </button>
                    <button
                        onClick={exportJSON}
                        className='text-white bg-green-500 hover:bg-green-600 focus:ring-4 focus:ring-green-300 font-medium rounded-lg text-sm px-4 py-2 text-center mr-2 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800 inline-flex items-center'
                    >
                        Export JSON
                    </button>
                </div>
            )}
        </div>
    );
}
