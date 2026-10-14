import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Box, FontInfo, PreviewPlan, WordEdit } from "../../../api";
import { cssFontSize, fontFamily } from "../../../fonts";
import { toggledEmphasis } from "./emphasis";
import { lineWords, retypedLine } from "./wordEdits";

// The longest a hook, a Kicker and a Text Layer can be (candidates.py's HOOK_MAX_CHARS,
// KICKER_MAX_CHARS, TEXT_LAYER_MAX_CHARS).
const HOOK_MAX_CHARS = 200;
const KICKER_MAX_CHARS = 24;
const TEXT_MAX_CHARS = 300;

const percent = (value: number) => `${value * 100}%`;

/** What is being retyped on the preview: the hook, its Kicker, the caption line at `line`, or a Text Layer. */
export type Editing = { kind: "hook" } | { kind: "kicker" } | { kind: "captions"; line: number } | { kind: "text"; id: string };

/**
 * Retyping on the preview: the hook's and the Kicker's text as written (with its Emphasis marks,
 * which the plan doesn't keep), and what a retyping saves: a hook's, a Kicker's or a Text Layer's
 * ("text:<id>") text, or a change of the Word Edits.
 */
export interface Retype {
  textOf: (id: "hook" | "kicker") => string;
  onText: (id: string, text: string) => void;
  onWords: (update: (edits: WordEdit[]) => WordEdit[]) => void;
}

/**
 * A text field over what `editing` names, in its font at its size on the stage, to retype it: Enter
 * (or leaving it) saves, Escape doesn't. A Text Layer takes new lines with Shift+Enter; the hook marks
 * its Emphasis with Cmd/Ctrl+B. Nothing when what it names is no longer in the plan.
 */
export function InlineText({
  preview,
  fontById,
  editing,
  retype,
  onClose,
}: {
  preview: PreviewPlan;
  fontById: Map<string, FontInfo>;
  editing: Editing;
  retype: Retype;
  onClose: () => void;
}) {
  const field = fieldFor(preview, fontById, editing, retype);
  if (!field) return null;
  return <TextField key={JSON.stringify(editing)} {...field} onClose={onClose} plan={preview.plan} />;
}

interface Field {
  area: Box;
  initial: string;
  font: FontInfo | undefined;
  size: number;
  uppercase: boolean;
  maxLength: number;
  label: string;
  multiline?: boolean;
  emphasis?: boolean;
  save: (text: string) => void;
}

function fieldFor(preview: PreviewPlan, fontById: Map<string, FontInfo>, editing: Editing, retype: Retype): Field | null {
  const plan = preview.plan;
  const hook = plan.hook;
  switch (editing.kind) {
    case "hook": {
      if (!hook) return null;
      const initial = retype.textOf("hook");
      return {
        area: hook.area,
        initial,
        font: fontById.get(plan.hook_style.font),
        size: hook.size,
        uppercase: plan.hook_style.uppercase,
        maxLength: HOOK_MAX_CHARS,
        label: "Hook text",
        emphasis: true,
        save: (text) => text.trim() !== initial.trim() && retype.onText("hook", text),
      };
    }
    case "kicker": {
      if (!hook?.kicker) return null;
      const initial = retype.textOf("kicker");
      return {
        area: hook.kicker.box,
        initial,
        font: fontById.get(plan.hook_style.font),
        size: hook.kicker.size,
        uppercase: plan.hook_style.uppercase,
        maxLength: KICKER_MAX_CHARS,
        label: "Kicker",
        save: (text) => text.trim() !== initial.trim() && retype.onText("kicker", text.trim()),
      };
    }
    case "captions": {
      const line = plan.captions[editing.line];
      if (!line) return null;
      const shown = line.words.map((word) => word.text);
      const initial = shown.join(" ");
      return {
        area: line.area,
        initial,
        font: fontById.get(plan.caption_style.font),
        size: line.size,
        uppercase: plan.caption_style.uppercase,
        maxLength: HOOK_MAX_CHARS,
        label: "Caption line",
        save: (typed) => {
          if (typed.trim().split(/\s+/).join(" ") === initial) return;
          const words = lineWords(line, preview.words);
          retype.onWords((edits) => retypedLine(edits, words, shown, typed));
        },
      };
    }
    case "text": {
      const event = plan.texts.find((other) => other.layer.id === editing.id);
      if (!event) return null;
      return {
        area: event.area,
        initial: event.layer.text,
        font: fontById.get(event.layer.font),
        size: event.size,
        uppercase: false,
        maxLength: TEXT_MAX_CHARS,
        label: "Text",
        multiline: true,
        save: (text) => text !== event.layer.text && retype.onText(`text:${editing.id}`, text),
      };
    }
  }
}

function TextField({
  plan,
  area,
  initial,
  font,
  size,
  uppercase,
  maxLength,
  label,
  multiline,
  emphasis,
  save,
  onClose,
}: Field & { plan: PreviewPlan["plan"]; onClose: () => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  // Where focus was before, to give it back; and whether this edit is over (saved or not).
  const before = useRef<Element | null>(null);
  const over = useRef(false);

  useEffect(() => {
    before.current = document.activeElement;
    const element = field.current;
    element?.focus();
    element?.select();
  }, []);
  // As tall as its lines.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  function close(saving: boolean) {
    if (over.current) return;
    over.current = true;
    if (saving) save(text);
    onClose();
    if (before.current instanceof HTMLElement && before.current.isConnected) before.current.focus();
  }

  const fontSize = font ? cssFontSize(font, size) : size;
  const style: CSSProperties = {
    left: percent((area.x + area.width / 2) / plan.width),
    top: percent(area.y / plan.height),
    minWidth: percent(area.width / plan.width),
    maxWidth: "96%",
    // As large as the text on the stage, but never under 16px (which would zoom a phone's page).
    fontSize: `max(16px, calc(var(--scale) * ${fontSize}px))`,
    fontFamily: font ? fontFamily(font.id) : undefined,
    textTransform: uppercase ? "uppercase" : undefined,
  };
  return (
    <textarea
      ref={field}
      aria-label={label}
      value={text}
      maxLength={maxLength}
      rows={1}
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => close(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          close(false);
        } else if (event.key === "Enter" && !(multiline && event.shiftKey)) {
          event.preventDefault();
          close(true);
        } else if (emphasis && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
          event.preventDefault();
          const element = event.currentTarget;
          const toggled = toggledEmphasis(text, [element.selectionStart, element.selectionEnd]);
          if (!toggled) return;
          setText(toggled.text);
          requestAnimationFrame(() => element.setSelectionRange(...toggled.selection));
        }
      }}
      className="absolute z-10 w-max -translate-x-1/2 resize-none overflow-hidden rounded-[6px] bg-black/75 px-2 py-1 text-center leading-tight text-white outline-2 outline-accent [field-sizing:content]"
      style={style}
    />
  );
}
