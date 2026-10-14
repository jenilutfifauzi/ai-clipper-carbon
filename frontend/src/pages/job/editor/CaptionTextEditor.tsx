import { CornerDownLeft, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PreviewPlan, PreviewWord, WordEdit } from "../../../api";
import { Button } from "../../../components/Button";
import { cx, formatPrecise } from "../../../format";
import { usePlayback, type Playback } from "./playback";

/**
 * The captions' Words, as the plan breaks them into lines, for correcting: click a Word to hear it
 * and edit it. An edit gives it new text, removes it, or starts a line at it; each is saved at once
 * as the Candidate's Word Edits. `focus` (seconds into the Clip) opens the Word spoken then, e.g.
 * from the timeline.
 */
export function CaptionTextEditor({
  preview,
  clipStart,
  edits,
  playback,
  focus,
  onChange,
}: {
  preview: PreviewPlan;
  // The Clip's start on the Source's timeline: edits are keyed on it.
  clipStart: number;
  edits: WordEdit[];
  playback: Playback;
  focus?: { at: number } | null;
  onChange: (edits: WordEdit[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const words = preview.words;
  const spoken = usePlayback(playback, (time) => words.findIndex((word) => word.start <= time && time < word.end));
  // Where the plan starts its lines: the first Word of each caption event.
  const lineStarts = new Set(preview.plan.captions.map((event) => event.words[0]?.start.toFixed(3)));

  useEffect(() => {
    if (!focus) return;
    const index = words.findIndex((word) => word.end > focus.at);
    if (index !== -1) setOpen(index);
  }, [focus, words]);

  // The time a Word's edit is keyed by: its edit's own, or its middle on the Source's timeline.
  const keyOf = (word: PreviewWord) => word.edit?.at ?? Math.round((clipStart + (word.start + word.end) / 2) * 1000) / 1000;

  function apply(word: PreviewWord, change: Partial<Pick<WordEdit, "text" | "break_before">>) {
    const at = keyOf(word);
    const next: WordEdit = { at, text: word.edit?.text ?? null, break_before: word.edit?.break_before ?? false, ...change };
    if (next.text === word.text) next.text = null;
    const others = edits.filter((edit) => edit.at !== at);
    onChange(next.text === null && !next.break_before ? others : [...others, next].sort((a, b) => a.at - b.at));
  }

  if (words.length === 0) return <p className="text-sm text-muted">No words are heard in this clip.</p>;
  const editedCount = words.filter((word) => word.edit).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Click a word to correct it, remove it or start a new line there.
          {preview.words_source === "transcript" && " These are the episode transcript's words until the clip is prepared."}
        </p>
        {editedCount > 0 && (
          <Button size="xs" variant="ghost" onClick={() => onChange([])}>
            <RotateCcw aria-hidden size={14} />
            Restore all {editedCount}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-2 rounded-control bg-fill p-2">
        {lines(words, lineStarts).map((line) => (
          <span key={line[0]} className="inline-flex flex-wrap items-center rounded-[10px] px-0.5 ring-1 ring-border">
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
                    "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-base",
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
      </div>
      {open !== null && words[open] && (
        <WordForm
          key={keyOf(words[open])}
          word={words[open]}
          clipStart={clipStart}
          onApply={(change) => apply(words[open], change)}
          onClose={() => setOpen(null)}
        />
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
  clipStart,
  onApply,
  onClose,
}: {
  word: PreviewWord;
  clipStart: number;
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
          Word at {formatPrecise(clipStart + word.start)}, heard as “{word.text}”
        </label>
        <input
          ref={input}
          id={`${id}-text`}
          value={text}
          maxLength={40}
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
