import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Segment, Word } from "../../api";
import { Button } from "../../components/Button";
import { cx, formatClock, formatPrecise } from "../../format";

// The transcript shown around the Candidate, and how far "Earlier" and "Later" reach further.
const CONTEXT_SECS = 30;
const MORE_SECS = 60;
// A line longer than this breaks at the next Word, for Segments that run on (Whisper's can).
const LINE_MAX_SECS = 12;
// Words and edges are compared to the millisecond the backend rounds to.
const EPS = 0.001;

const CLIP = "bg-accent/20";
const PENDING = "bg-waiting/25";

export interface WordRange {
  first: number;
  last: number;
}

/**
 * The Words around a Candidate, by line, with the Candidate's Words highlighted and its first and
 * last marked. Only a window around the Candidate is rendered, never a whole 3-hour Transcript:
 * about a minute either side, reaching further on request.
 *
 * Clicking a Word (or Enter on it; arrow keys move between Words) calls `onPick`. Dragging across
 * Words calls `onRange` with the Words selected. `pending` is a range being chosen for a new clip.
 * Key it by the Candidate's id, so that another Candidate starts from a fresh window.
 */
export function TranscriptPicker({
  words,
  segments,
  start,
  end,
  pending,
  onPick,
  onRange,
}: {
  words: Word[];
  segments: Segment[];
  start: number;
  end: number;
  pending: { first: number; last: number | null } | null;
  onPick: (index: number) => void;
  onRange: (range: WordRange) => void;
}) {
  const starts = useMemo(() => words.map((word) => word.start), [words]);
  // Which Words begin a Segment, so each Segment starts a line.
  const opensLine = useMemo(() => {
    const opens = new Uint8Array(words.length);
    for (const segment of segments) {
      const i = lowerBound(starts, segment.start - EPS);
      if (i < words.length) opens[i] = 1;
    }
    return opens;
  }, [segments, starts, words.length]);

  const [view, setView] = useState({ from: start - CONTEXT_SECS, to: end + CONTEXT_SECS });
  const container = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const selecting = useRef(false);

  const first = lowerBound(starts, start - EPS);
  const last = lowerBound(starts, end - EPS) - 1;

  // On mount, scroll the Candidate's first Word into view (a line of context above it).
  useLayoutEffect(() => {
    const box = container.current;
    const word = box?.querySelector<HTMLElement>(`[data-i="${first}"]`);
    if (box && word) box.scrollTop = Math.max(0, word.offsetTop - 56);
    // Only on mount: later edits leave the scroll where the owner put it.
  }, []);
  // An edge moved outside the window: widen it.
  useEffect(() => {
    setView((old) => ({ from: Math.min(old.from, start - CONTEXT_SECS), to: Math.max(old.to, end + CONTEXT_SECS) }));
  }, [start, end]);

  const lo = lowerBound(starts, view.from);
  const hi = lowerBound(starts, view.to);
  const lines: number[][] = [];
  for (let i = lo; i < hi; i++) {
    const line = lines[lines.length - 1];
    if (!line || opensLine[i] || words[i].start - words[line[0]].start > LINE_MAX_SECS) lines.push([i]);
    else line.push(i);
  }
  const focusable = cursor !== null && cursor >= lo && cursor < hi ? cursor : Math.min(Math.max(first, lo), hi - 1);

  const [pendingFirst, pendingLast] = pending
    ? [Math.min(pending.first, pending.last ?? pending.first), Math.max(pending.first, pending.last ?? pending.first)]
    : [-1, -2];

  function wordIndex(target: EventTarget | null): number | null {
    const element = (target as HTMLElement | null)?.closest?.("[data-i]");
    return element ? Number(element.getAttribute("data-i")) : null;
  }

  function onMouseUp() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !container.current) return;
    const a = selectedWord(selection.anchorNode, container.current);
    const b = selectedWord(selection.focusNode, container.current);
    if (a === null || b === null) return;
    selecting.current = true;
    selection.removeAllRanges();
    onRange({ first: Math.min(a, b), last: Math.max(a, b) });
  }

  function onClick(event: MouseEvent) {
    if (selecting.current) {
      selecting.current = false;
      return;
    }
    const i = wordIndex(event.target);
    if (i !== null) {
      setCursor(i);
      onPick(i);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const i = wordIndex(event.target);
    if (i === null) return;
    let next = i;
    if (event.key === "ArrowRight") next = Math.min(i + 1, hi - 1);
    else if (event.key === "ArrowLeft") next = Math.max(i - 1, lo);
    else if (event.key === "Home") next = lo;
    else if (event.key === "End") next = hi - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(i);
      return;
    } else return;
    event.preventDefault();
    setCursor(next);
    container.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      {lo > 0 && (
        <Button
          variant="ghost"
          className="min-h-9 self-start px-2 text-sm"
          onClick={() => setView((old) => ({ ...old, from: old.from - MORE_SECS }))}
        >
          <ChevronUp aria-hidden size={16} />
          Earlier
        </Button>
      )}
      <div
        ref={container}
        role="group"
        aria-label="Transcript around the clip"
        onClick={onClick}
        onMouseUp={onMouseUp}
        onKeyDown={onKeyDown}
        className="relative max-h-80 overflow-y-auto overscroll-contain rounded-control border border-border bg-surface p-3 leading-7"
      >
        {lines.map((line) => (
          <p key={line[0]} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
            <span className="text-sm leading-7 text-muted tabular-nums select-none">{formatClock(words[line[0]].start)}</span>
            <span>
              {line.map((i) => {
                const inPending = i >= pendingFirst && i <= pendingLast;
                const inClip = i >= first && i <= last;
                // The space after a Word is highlighted with it when the next Word is too, so a
                // range reads as one stretch.
                const space = inPending && i < pendingLast ? PENDING : inClip && i < last ? CLIP : undefined;
                return (
                  <span key={i}>
                    <span
                      role="button"
                      tabIndex={i === focusable ? 0 : -1}
                      data-i={i}
                      title={formatPrecise(words[i].start)}
                      aria-label={
                        i === first ? `${words[i].text}, clip start` : i === last ? `${words[i].text}, clip end` : undefined
                      }
                      className={cx(
                        "cursor-pointer py-0.5",
                        inPending ? PENDING : inClip ? cx(CLIP, "hover:bg-accent/40") : "rounded-[4px] hover:bg-surface-raised",
                        i === first && "rounded-l-[4px] border-l-[3px] border-accent pl-1",
                        i === last && "rounded-r-[4px] border-r-[3px] border-accent pr-1",
                      )}
                    >
                      {words[i].text}
                    </span>
                    <span className={cx("py-0.5", space)}> </span>
                  </span>
                );
              })}
            </span>
          </p>
        ))}
      </div>
      {hi < words.length && (
        <Button
          variant="ghost"
          className="min-h-9 self-start px-2 text-sm"
          onClick={() => setView((old) => ({ ...old, to: old.to + MORE_SECS }))}
        >
          <ChevronDown aria-hidden size={16} />
          Later
        </Button>
      )}
    </div>
  );
}

// The first index whose value is at least `value`, in a sorted array.
export function lowerBound(values: number[], value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The Word a selection's anchor or focus is in, or next to (in the space after a Word).
function selectedWord(node: Node | null, container: HTMLElement): number | null {
  if (!node || !container.contains(node)) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const word = element?.closest("[data-i]") ?? element?.querySelector("[data-i]");
  return word ? Number(word.getAttribute("data-i")) : null;
}
