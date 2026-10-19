import { ChevronDown, CornerDownLeft, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PreviewPlan, PreviewWord, WordEdit } from "../../../api";
import { Button } from "../../../components/Button";
import { cx, formatPrecise } from "../../../format";
import { usePlayback, type Playback } from "./playback";
import { editKey, withWordEdit, WORD_EDIT_MAX_CHARS } from "./wordEdits";

/**
 * The captions' Words, as the plan breaks them into lines, for correcting: click a Word to hear it
 * and edit it. An edit gives it new text, removes it, or starts a line at it; each is saved at once
 * as the Candidate's Word Edits. `focus` (seconds into the Clip) opens the Word spoken then, e.g.
 * from the timeline. With `only` (a picked Cue's, in the Advanced Edit), just those Words, and
 * Restore all restores just theirs.
 */
export function CaptionTextEditor({
  preview,
  edits,
  playback,
  focus,
  only,
  onChange,
}: {
  preview: PreviewPlan;
  edits: WordEdit[];
  playback: Playback;
  focus?: { at: number } | null;
  only?: PreviewWord[];
  onChange: (edits: WordEdit[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // A long clip's lines start folded to their first few; the timeline focusing a Word unfolds them.
  const [expanded, setExpanded] = useState(false);
  const words = only ?? preview.words;
  const spoken = usePlayback(playback, (time) => words.findIndex((word) => word.start <= time && time < word.end));
  // Where the plan starts its lines: the first Word of each Cue.
  const lineStarts = new Set(preview.plan.captions.map((event) => event.lines[0]?.[0]?.start.toFixed(3)));

  useEffect(() => {
    if (!focus) return;
    const index = words.findIndex((word) => word.end > focus.at);
    if (index !== -1) {
      setOpen(index);
      setExpanded(true);
    }
  }, [focus, words]);

  function apply(word: PreviewWord, change: Partial<Pick<WordEdit, "text" | "break_before">>) {
    onChange(withWordEdit(edits, word, change));
  }

  if (words.length === 0) return <p className="text-sm text-muted">{only ? "Its words can't be listed yet." : "No words are heard in this clip."}</p>;
  const editedCount = words.filter((word) => word.edit).length;
  const grouped = lines(words, lineStarts);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Click a word to correct it, remove it or start a new line there.
          {!only && preview.words_source === "transcript" && " These are the episode transcript's words until the clip is prepared."}
        </p>
        {editedCount > 0 && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onChange(only ? edits.filter((edit) => !words.some((word) => word.edit?.at === edit.at)) : [])}
          >
            <RotateCcw aria-hidden size={14} />
            Restore all {editedCount}
          </Button>
        )}
      </div>
      <Fold expanded={expanded} onExpanded={setExpanded} count={grouped.length}>
        {grouped.map((line) => (
          <span key={line[0]} className="inline-flex flex-wrap items-center rounded-lg p-px ring-1 ring-border">
            {line.map((i) => {
              const word = words[i];
              const edit = word.edit;
              const removed = edit?.text === "";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    playback.seek(word.start);
                    setOpen(i);
                  }}
                  aria-pressed={open === i}
                  aria-label={edit?.break_before ? `${edit?.text || word.text}, starts a line` : undefined}
                  title={edit?.text != null && !removed ? `Heard as “${word.text}”` : undefined}
                  className={cx(
                    "inline-flex items-center gap-0.5 rounded-md px-[3px] text-sm leading-6 pointer-coarse:leading-8",
                    "focus-visible:outline-2 focus-visible:outline-focus",
                    open === i ? "bg-accent text-on-accent" : spoken === i ? "bg-surface-raised" : "hover:bg-surface-raised",
                    removed && open !== i && "text-muted line-through",
                    edit?.text && open !== i && "text-accent-text underline decoration-dotted underline-offset-4",
                  )}
                >
                  {edit?.break_before && <CornerDownLeft aria-hidden size={12} />}
                  {edit?.text || word.text}
                </button>
              );
            })}
          </span>
        ))}
      </Fold>
      {open !== null && words[open] && (
        <WordForm
          key={editKey(words[open])}
          word={words[open]}
          onApply={(change) => apply(words[open], change)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// The folded height: six rows of lines and the top of the next, so it reads as cut off.
const FOLDED = 196;

// The lines' box, folded to FOLDED when they run taller, with a button to unfold or fold them. Its
// height eases between the two; tabbing to a Word below the fold unfolds it.
function Fold({
  expanded,
  onExpanded,
  count,
  children,
}: {
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  count: number;
  children: ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    setHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const folds = height > FOLDED;
  const folded = folds && !expanded;

  return (
    <div ref={box} className="flex flex-col rounded-control bg-fill">
      <div
        id={id}
        style={folds ? { height: folded ? FOLDED : height } : undefined}
        className="overflow-hidden motion-safe:transition-[height] motion-safe:duration-300 motion-safe:ease-out"
        onFocus={(event) => {
          // Measured from the lines' top: focusing has already scrolled the box to the Word.
          if (!folded || !content.current) return;
          if (event.target.getBoundingClientRect().bottom - content.current.getBoundingClientRect().top <= FOLDED) return;
          event.currentTarget.scrollTop = 0;
          onExpanded(true);
        }}
      >
        <div
          ref={content}
          className={cx(
            "flex flex-wrap gap-1 p-1.5",
            folded && "[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent_calc(100%-0.25rem))]",
          )}
        >
          {children}
        </div>
      </div>
      {folds && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            onExpanded(!expanded);
            // Folding from far down would leave the page scrolled past the lines.
            if (expanded && box.current && box.current.getBoundingClientRect().top < 0) {
              const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              box.current.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
            }
          }}
          className={cx(
            "flex min-h-9 items-center justify-center gap-1.5 rounded-b-control border-t border-border text-sm font-medium text-muted",
            "hover:text-current focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            "motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
          )}
        >
          {expanded ? "Show less" : `Show all ${count} lines`}
          <ChevronDown
            aria-hidden
            size={15}
            className={cx("motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out", expanded && "rotate-180")}
          />
        </button>
      )}
    </div>
  );
}

// The Words (their indices) in lines: a line starts where the plan starts one, or where a Word is
// edited to; a removed Word stays with the line before it.
function lines(words: PreviewWord[], starts: Set<string>): number[][] {
  const grouped: number[][] = [];
  words.forEach((word, i) => {
    if (grouped.length === 0 || word.edit?.break_before || (word.edit?.text !== "" && starts.has(word.start.toFixed(3)))) grouped.push([i]);
    else grouped[grouped.length - 1].push(i);
  });
  return grouped;
}

// The open Word's correction: its text, and buttons to remove it, start a line at it, or restore it.
function WordForm({
  word,
  onApply,
  onClose,
}: {
  word: PreviewWord;
  onApply: (change: Partial<Pick<WordEdit, "text" | "break_before">>) => void;
  onClose: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const edit = word.edit;
  const [text, setText] = useState(edit?.text || word.text);
  useEffect(() => input.current?.select(), []);

  return (
    <form
      className="raised flex flex-col gap-3 rounded-control p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onApply({ text: text.trim() });
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          Word at {formatPrecise(word.at)}, heard as “{word.text}”
        </label>
        <input
          ref={input}
          id={`${id}-text`}
          value={text}
          maxLength={WORD_EDIT_MAX_CHARS}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          className="min-h-10 rounded-[10px] border border-border bg-fill px-3 text-base"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
          Save
        </Button>
        <Button size="sm" onClick={() => onApply({ break_before: !edit?.break_before })} aria-pressed={edit?.break_before ?? false}>
          <CornerDownLeft aria-hidden size={15} />
          {edit?.break_before ? "No new line here" : "New line here"}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onApply({ text: edit?.text === "" ? null : "" });
            onClose();
          }}
        >
          <Trash2 aria-hidden size={15} />
          {edit?.text === "" ? "Show again" : "Remove"}
        </Button>
        {edit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onApply({ text: null, break_before: false });
              onClose();
            }}
          >
            <RotateCcw aria-hidden size={15} />
            Restore
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close" className="ml-auto">
          <X aria-hidden size={15} />
        </Button>
      </div>
    </form>
  );
}
