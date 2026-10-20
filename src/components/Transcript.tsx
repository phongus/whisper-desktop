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

function EditableTranscriptText({
    text,
    lineNumber,
    disabled,
    onSave,
}: {
    text: string;
    lineNumber: number;
    disabled: boolean;
    onSave: (text: string) => void;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState("");

    useEffect(() => {
        setIsEditing(false);
    }, [text, disabled]);

    const save = () => {
        onSave(draft);
        setIsEditing(false);
    };

    return (
        <div className='relative flex-1 min-w-0'>
            <button
                type='button'
                className={`block w-full min-h-[1.5rem] text-left whitespace-pre-wrap break-words rounded hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:hover:bg-transparent disabled:cursor-text ${
                    isEditing ? "invisible" : ""
                }`}
                aria-label={`Edit transcript line ${lineNumber}`}
                aria-hidden={isEditing}
                title='Edit transcript text'
                disabled={disabled || isEditing}
                onClick={() => {
                    setDraft(text);
                    setIsEditing(true);
                }}
            >
                {isEditing ? `${draft}\u200b` : text}
            </button>
            {isEditing && (
                <textarea
                    autoFocus
                    aria-label={`Edit transcript line ${lineNumber}`}
                    className='absolute inset-0 block w-full h-full min-h-[1.5rem] resize-none overflow-hidden whitespace-pre-wrap break-words rounded focus:outline-none focus:ring-2 focus:ring-blue-300'
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={save}
                    onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            save();
                        } else if (event.key === "Escape") {
                            event.preventDefault();
                            setIsEditing(false);
                        }
                    }}
                />
            )}
        </div>
    );
}

export default function Transcript({ transcribedData }: Props) {
    const divRef = useRef<HTMLDivElement>(null);

    // Source segments from the transcriber (immutable). Edits live in local
    // state below as overrides + name map; we never mutate the underlying
    // diarization output.
    const segments = transcribedData?.segments;
    const chunks = transcribedData?.chunks;
    const [textOverrides, setTextOverrides] = useState<Record<number, string>>(
        {},
    );
    const textEditingDisabled =
        !!transcribedData?.isBusy || !!transcribedData?.diarizing;

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
    // Indices of transcript rows selected for bulk reassignment.
    const [selectedSegmentIndices, setSelectedSegmentIndices] = useState<
        number[]
    >([]);
    // Anchor index used for Shift+click range selection.
    const [selectionAnchor, setSelectionAnchor] = useState<number | null>(
        null,
    );
    // Selected speaker target used by the bulk assign controls.
    const [bulkSpeakerTarget, setBulkSpeakerTarget] = useState("");

    const segmentsRef = useRef<DiarizedSegment[] | undefined>(undefined);
    const chunksRef = useRef(chunks);
    useEffect(() => {
        if (segmentsRef.current !== segments || chunksRef.current !== chunks) {
            segmentsRef.current = segments;
            chunksRef.current = chunks;
            setTextOverrides({});
            setNameMap({});
            setOverrides({});
            setExtraSpeakers([]);
            setEditing(null);
            setSelectedSegmentIndices([]);
            setBulkSpeakerTarget("");
            setSelectionAnchor(null);
        }
    }, [segments, chunks]);

    // All speaker IDs known to this transcript (from diarization + manually
    // added). Used to populate the reassign menu.
    const allSpeakerIds = useMemo(() => {
        const set = new Set<string>();
        segments?.forEach((s) => set.add(s.speaker));
        extraSpeakers.forEach((id) => set.add(id));
        return Array.from(set);
    }, [segments, extraSpeakers]);

    const displayName = (id: string) => nameMap[id] ?? id;

    useEffect(() => {
        if (allSpeakerIds.length === 0) {
            if (bulkSpeakerTarget !== "") setBulkSpeakerTarget("");
            return;
        }
        if (!bulkSpeakerTarget || !allSpeakerIds.includes(bulkSpeakerTarget)) {
            setBulkSpeakerTarget(allSpeakerIds[0]);
        }
    }, [allSpeakerIds, bulkSpeakerTarget]);

    /** Apply overrides to produce the rendered/exported segments. */
    const effectiveSegments = useMemo<DiarizedSegment[]>(() => {
        if (!segments) return [];
        return segments.map((s, i) => ({
            ...s,
            text: textOverrides[i] ?? s.text,
            speaker: overrides[i] ?? s.speaker,
        }));
    }, [segments, overrides, textOverrides]);

    const effectiveChunks = useMemo(
        () =>
            chunks?.map((chunk, index) => ({
                ...chunk,
                text: textOverrides[index] ?? chunk.text,
            })) ?? [],
        [chunks, textOverrides],
    );

    const saveText = (index: number, text: string) => {
        setTextOverrides((prev) => ({ ...prev, [index]: text }));
    };

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
            text = effectiveChunks
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
            jsonData = JSON.stringify(effectiveChunks, null, 2);
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

    const selectedSet = useMemo(
        () => new Set(selectedSegmentIndices),
        [selectedSegmentIndices],
    );

    const toggleSegmentSelection = (
        segmentIndex: number,
        options?: { shiftKey?: boolean },
    ) => {
        setSelectedSegmentIndices((prev) => {
            if (options?.shiftKey && selectionAnchor !== null) {
                const start = Math.min(selectionAnchor, segmentIndex);
                const end = Math.max(selectionAnchor, segmentIndex);
                const range = Array.from(
                    { length: end - start + 1 },
                    (_, idx) => start + idx,
                );
                return Array.from(new Set([...prev, ...range])).sort(
                    (a, b) => a - b,
                );
            }
            if (prev.includes(segmentIndex)) {
                return prev.filter((i) => i !== segmentIndex);
            }
            return [...prev, segmentIndex].sort((a, b) => a - b);
        });
        setSelectionAnchor(segmentIndex);
    };

    const clearSelection = () => {
        setSelectedSegmentIndices([]);
        setSelectionAnchor(null);
    };

    const selectAllSegments = () => {
        setSelectedSegmentIndices(effectiveSegments.map((_, i) => i));
        if (effectiveSegments.length > 0) {
            setSelectionAnchor(0);
        }
    };

    const assignSpeakerToSelected = (speakerId: string) => {
        if (!speakerId || selectedSegmentIndices.length === 0) return;
        setOverrides((prev) => {
            const next = { ...prev };
            for (const index of selectedSegmentIndices) {
                const original = segments?.[index]?.speaker;
                if (original === speakerId) {
                    delete next[index];
                } else {
                    next[index] = speakerId;
                }
            }
            return next;
        });
        setEditing(null);
    };

    const addAndAssignNewSpeakerToSelected = () => {
        if (selectedSegmentIndices.length === 0) return;
        const taken = new Set(allSpeakerIds);
        const id = nextSpeakerId(taken);
        setExtraSpeakers((prev) => [...prev, id]);
        setOverrides((prev) => {
            const next = { ...prev };
            for (const index of selectedSegmentIndices) {
                next[index] = id;
            }
            return next;
        });
        setBulkSpeakerTarget(id);
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
            {hasSpeakers && (
                <div className='w-full mb-2 bg-slate-50 rounded-lg p-2 ring-1 ring-slate-200 flex flex-wrap items-center gap-2 text-sm'>
                    <span className='text-slate-700'>
                        Multi-select: {selectedSegmentIndices.length} selected
                    </span>
                    <button
                        type='button'
                        className='px-2 py-1 rounded bg-white ring-1 ring-slate-300 hover:bg-slate-100 disabled:opacity-50'
                        onClick={selectAllSegments}
                        disabled={effectiveSegments.length === 0}
                    >
                        Select all
                    </button>
                    <button
                        type='button'
                        className='px-2 py-1 rounded bg-white ring-1 ring-slate-300 hover:bg-slate-100 disabled:opacity-50'
                        onClick={clearSelection}
                        disabled={selectedSegmentIndices.length === 0}
                    >
                        Clear
                    </button>
                    <select
                        className='bg-white border border-gray-300 text-gray-900 text-sm rounded-lg p-1.5 disabled:opacity-50'
                        value={bulkSpeakerTarget}
                        onChange={(e) => setBulkSpeakerTarget(e.target.value)}
                        disabled={allSpeakerIds.length === 0}
                        aria-label='Assign selected to speaker'
                    >
                        {allSpeakerIds.map((id) => (
                            <option key={id} value={id}>
                                {displayName(id)}
                            </option>
                        ))}
                    </select>
                    <button
                        type='button'
                        className='px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                        onClick={() => assignSpeakerToSelected(bulkSpeakerTarget)}
                        disabled={
                            selectedSegmentIndices.length === 0 ||
                            !bulkSpeakerTarget
                        }
                    >
                        Apply to selected
                    </button>
                    <button
                        type='button'
                        className='px-2 py-1 rounded bg-white text-blue-600 ring-1 ring-blue-200 hover:bg-blue-50 disabled:opacity-50'
                        onClick={addAndAssignNewSpeakerToSelected}
                        disabled={selectedSegmentIndices.length === 0}
                    >
                        + New speaker for selected
                    </button>
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
                              key={i}
                              className='w-full flex flex-col mb-2 bg-white rounded-lg p-4 shadow-xl shadow-black/5 ring-1 ring-slate-700/10'
                          >
                              <div className='flex flex-row items-start'>
                                  <div className='mr-3 mt-1'>
                                      <input
                                          type='checkbox'
                                          checked={selectedSet.has(i)}
                                          onChange={(e) =>
                                              toggleSegmentSelection(i, {
                                                  shiftKey:
                                                      (
                                                          e.nativeEvent as MouseEvent
                                                      ).shiftKey,
                                              })
                                          }
                                          aria-label={`Select line ${
                                              i + 1
                                          } for bulk edits`}
                                      />
                                  </div>
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
                                  <EditableTranscriptText
                                      text={seg.text}
                                      lineNumber={i + 1}
                                      disabled={textEditingDisabled}
                                      onSave={(text) => saveText(i, text)}
                                  />
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
                : effectiveChunks.map((chunk, i) => (
                      <div
                          key={i}
                          className='w-full flex flex-row mb-2 bg-white rounded-lg p-4 shadow-xl shadow-black/5 ring-1 ring-slate-700/10'
                      >
                          <div className='mr-5'>
                              {formatAudioTimestamp(chunk.timestamp[0])}
                          </div>
                          <EditableTranscriptText
                              text={chunk.text}
                              lineNumber={i + 1}
                              disabled={textEditingDisabled}
                              onSave={(text) => saveText(i, text)}
                          />
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
