import { RotateCcw, Save, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  api,
  type Candidate,
  type CandidateChange,
  type CaptionStyle,
  type FontInfo,
  type HookStyle,
  type StyleOverrides,
  type StylePreset,
  type StyleValue,
} from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Skeleton } from "../../../components/Skeleton";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { fontFamily } from "../../../fonts";
import { HookShapePicker } from "./HookShapePicker";

// Changes are saved once they pause this long, and at once when the Candidate is left.
const SAVE_AFTER_MS = 700;

export interface StyleDraft {
  preset_id: string;
  style_overrides: StyleOverrides;
}

type Part = "caption" | "hook";

const HIGHLIGHTS = [
  { value: "colour", label: "Colour" },
  { value: "box", label: "Box" },
  { value: "none", label: "None" },
] as const;

const CAPTION_POSITIONS = [
  { value: "auto", label: "Auto" },
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
  { value: "custom", label: "Custom" },
] as const;

const HOOK_POSITIONS = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
  { value: "custom", label: "Custom" },
] as const;

const HOOK_LINES = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

const HOOK_ALIGNS = [
  { value: "center", label: "Centre" },
  { value: "left", label: "Left" },
] as const;

const ANIMATIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide", label: "Slide" },
] as const;

const MAX_WORDS = [
  { value: "", label: "No limit" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
];

const EMPTY: StyleOverrides = { caption: {}, hook: {} };

/**
 * The Candidate's Style Preset and the fields of it the Candidate overrides. Each control shows the
 * resolved value; one that differs from the Preset is an override, marked with a reset button.
 * Changes preview at once (`onDraft`) and are saved after a pause (`onSave`). The Candidate's look
 * can be saved as a new Preset, or into its Preset (not a built-in one). Key it by the Candidate's id.
 */
export function StylePanel({
  candidate,
  fonts,
  onDraft,
  onSave,
}: {
  candidate: Candidate;
  fonts: FontInfo[] | null;
  onDraft: (draft: StyleDraft) => void;
  onSave: (change: CandidateChange) => void;
}) {
  const [presets, setPresets] = useState<StylePreset[] | null>(null);
  const [draft, setDraft] = useState<StyleDraft>({ preset_id: candidate.preset_id, style_overrides: candidate.style_overrides });
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saved = useRef(JSON.stringify(draft));
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(() => {
    api.listPresets().then(setPresets, (reason: Error) => setError(reason.message));
  }, []);

  function flush(next: StyleDraft) {
    clearTimeout(timer.current);
    const key = JSON.stringify(next);
    if (key === saved.current) return;
    saved.current = key;
    onSave(next);
  }
  // Leaving the Candidate saves what was changed.
  useEffect(() => () => flush(latest.current), []);

  function change(next: StyleDraft, now = false) {
    setDraft(next);
    onDraft(next);
    clearTimeout(timer.current);
    if (now) flush(next);
    else timer.current = setTimeout(() => flush(next), SAVE_AFTER_MS);
  }

  if (error && !presets) return <p className="text-sm text-muted">Couldn't load the presets: {error}</p>;
  if (!presets) return <StyleSkeleton />;
  const preset = presets.find((p) => p.id === draft.preset_id) ?? presets[0];
  const caption = { ...preset.caption, ...draft.style_overrides.caption } as CaptionStyle;
  const hook = { ...preset.hook, ...draft.style_overrides.hook } as HookStyle;
  const overridden = Object.keys(draft.style_overrides.caption).length + Object.keys(draft.style_overrides.hook).length > 0;

  function set(part: Part, field: string, value: StyleValue) {
    const base = preset[part] as unknown as Record<string, StyleValue>;
    const fields = { ...draft.style_overrides[part] } as Record<string, StyleValue>;
    if (base[field] === value) delete fields[field];
    else fields[field] = value;
    change({ ...draft, style_overrides: { ...draft.style_overrides, [part]: fields } });
  }

  // The reset button of an overridden field, after its label.
  function marker(part: Part, field: string, label: string) {
    if (!(field in draft.style_overrides[part])) return null;
    return (
      <button
        type="button"
        onClick={() => set(part, field, (preset[part] as unknown as Record<string, StyleValue>)[field])}
        aria-label={`Reset ${label} to the preset`}
        title="Changed from the preset: reset"
        className="-my-2 inline-flex size-7 items-center justify-center rounded-full text-accent-text hover:bg-fill"
      >
        <RotateCcw aria-hidden size={13} />
      </button>
    );
  }

  const fontOptions = (fonts ?? []).map((font) => ({ value: font.id, label: font.label }));
  const fontStyle = (id: string) => (fonts?.some((font) => font.id === id) ? { fontFamily: fontFamily(id) } : undefined);

  return (
    <div className="flex flex-col gap-5">
      <PresetBar
        presets={presets}
        preset={preset}
        overridden={overridden}
        caption={caption}
        hook={hook}
        onPick={(id) => change({ preset_id: id, style_overrides: EMPTY }, true)}
        onReset={() => change({ ...draft, style_overrides: EMPTY }, true)}
        onSaved={(saved, all) => {
          setPresets(all);
          change({ preset_id: saved.id, style_overrides: EMPTY }, true);
        }}
        onDeleted={(all) => {
          setPresets(all);
          change({ preset_id: "default", style_overrides: EMPTY }, true);
        }}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">Captions</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Select
            label="Font"
            value={caption.font}
            options={fontOptions}
            onChange={(value) => set("caption", "font", value)}
            marker={marker("caption", "font", "font")}
            optionStyle={fontStyle}
          />
          <Slider label="Size" value={caption.size} min={40} max={200} onChange={(v) => set("caption", "size", v)} marker={marker("caption", "size", "size")} />
          <ColorField label="Text colour" value={caption.colour} onChange={(v) => set("caption", "colour", v)} marker={marker("caption", "colour", "text colour")} />
          <ColorField
            label="Highlight colour"
            value={caption.active_colour}
            onChange={(v) => set("caption", "active_colour", v)}
            marker={marker("caption", "active_colour", "highlight colour")}
          />
          <Slider label="Outline" value={caption.outline} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("caption", "outline", v)} marker={marker("caption", "outline", "outline")} />
          <ColorField
            label="Outline colour"
            value={caption.outline_colour}
            onChange={(v) => set("caption", "outline_colour", v)}
            marker={marker("caption", "outline_colour", "outline colour")}
          />
          <Slider label="Shadow" value={caption.shadow} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("caption", "shadow", v)} marker={marker("caption", "shadow", "shadow")} />
          <ColorField
            label="Shadow colour"
            value={caption.shadow_colour}
            onChange={(v) => set("caption", "shadow_colour", v)}
            marker={marker("caption", "shadow_colour", "shadow colour")}
          />
        </div>
        <Segmented
          legend="Highlight the spoken word"
          options={HIGHLIGHTS}
          value={caption.highlight}
          onChange={(v) => set("caption", "highlight", v)}
          className="max-w-sm"
        />
        <Segmented legend="Position" options={CAPTION_POSITIONS} value={caption.position} onChange={(v) => set("caption", "position", v)} />
        {caption.position === "custom" && (
          <Slider label="Height of the line's centre" value={caption.y} min={332} max={1436} format={(v) => `${v} px`} onChange={(v) => set("caption", "y", v)} marker={marker("caption", "y", "height")} />
        )}
        <Switch checked={caption.uppercase} onChange={(v) => set("caption", "uppercase", v)}>
          <span className="flex items-center gap-1.5 text-sm">
            UPPERCASE {marker("caption", "uppercase", "uppercase")}
          </span>
        </Switch>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">Line breaks</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Slider label="Most characters" value={caption.max_chars} min={4} max={60} onChange={(v) => set("caption", "max_chars", v)} marker={marker("caption", "max_chars", "most characters")} />
          <Select
            label="Most words"
            value={caption.max_words === null ? "" : String(caption.max_words)}
            options={MAX_WORDS}
            onChange={(v) => set("caption", "max_words", v === "" ? null : Number(v))}
            marker={marker("caption", "max_words", "most words")}
          />
          <Slider
            label="Longest on screen"
            value={caption.max_secs}
            min={0.3}
            max={5}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => set("caption", "max_secs", v)}
            marker={marker("caption", "max_secs", "longest on screen")}
          />
          <Slider
            label="New line after a pause of"
            value={caption.pause_secs}
            min={0.1}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)} s`}
            onChange={(v) => set("caption", "pause_secs", v)}
            marker={marker("caption", "pause_secs", "pause")}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-2 font-semibold">Hook style</legend>
        <HookShapePicker style={hook} onChange={(v) => set("hook", "shape", v)} marker={marker("hook", "shape", "shape")} />

        <Group title="Text">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <Select
              label="Font"
              value={hook.font}
              options={fontOptions}
              onChange={(value) => set("hook", "font", value)}
              marker={marker("hook", "font", "hook font")}
              optionStyle={fontStyle}
            />
            <Slider label="Size" value={hook.size} min={40} max={160} onChange={(v) => set("hook", "size", v)} marker={marker("hook", "size", "hook size")} />
            <ColorField label="Text colour" value={hook.colour} onChange={(v) => set("hook", "colour", v)} marker={marker("hook", "colour", "hook text colour")} />
            <ColorField
              label="Emphasis colour"
              value={hook.emphasis_colour}
              onChange={(v) => set("hook", "emphasis_colour", v)}
              marker={marker("hook", "emphasis_colour", "emphasis colour")}
            />
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <Segmented
              legend="Most lines"
              options={HOOK_LINES}
              value={String(hook.max_lines) as (typeof HOOK_LINES)[number]["value"]}
              onChange={(v) => set("hook", "max_lines", Number(v))}
              marker={marker("hook", "max_lines", "most lines")}
            />
            <Segmented legend="Align" options={HOOK_ALIGNS} value={hook.align} onChange={(v) => set("hook", "align", v)} marker={marker("hook", "align", "alignment")} />
          </div>
          <Switch checked={hook.uppercase} onChange={(v) => set("hook", "uppercase", v)}>
            <span className="flex items-center gap-1.5 text-sm">
              UPPERCASE {marker("hook", "uppercase", "hook uppercase")}
            </span>
          </Switch>
        </Group>

        <Group title={hook.shape === "none" ? "Outline and shadow" : "Box, outline and shadow"}>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {hook.shape !== "none" && (
              <>
                <ColorField label="Box colour" value={hook.box_colour} onChange={(v) => set("hook", "box_colour", v)} marker={marker("hook", "box_colour", "box colour")} />
                <Slider
                  label="Box opacity"
                  value={hook.box_opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => set("hook", "box_opacity", v)}
                  marker={marker("hook", "box_opacity", "box opacity")}
                />
                <Slider label="Corner radius" value={hook.radius} min={0} max={80} format={(v) => `${v} px`} onChange={(v) => set("hook", "radius", v)} marker={marker("hook", "radius", "corner radius")} />
                <span aria-hidden className="max-sm:hidden" />
              </>
            )}
            <Slider label="Outline" value={hook.outline} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("hook", "outline", v)} marker={marker("hook", "outline", "hook outline")} />
            <ColorField
              label="Outline colour"
              value={hook.outline_colour}
              onChange={(v) => set("hook", "outline_colour", v)}
              marker={marker("hook", "outline_colour", "hook outline colour")}
            />
            <Slider label="Shadow" value={hook.shadow} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("hook", "shadow", v)} marker={marker("hook", "shadow", "hook shadow")} />
            <ColorField
              label="Shadow colour"
              value={hook.shadow_colour}
              onChange={(v) => set("hook", "shadow_colour", v)}
              marker={marker("hook", "shadow_colour", "hook shadow colour")}
            />
          </div>
        </Group>

        <Group title="Kicker">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <ColorField
              label="Text colour"
              value={hook.kicker_colour}
              onChange={(v) => set("hook", "kicker_colour", v)}
              marker={marker("hook", "kicker_colour", "kicker text colour")}
            />
            <ColorField
              label="Pill colour"
              value={hook.kicker_box_colour}
              onChange={(v) => set("hook", "kicker_box_colour", v)}
              marker={marker("hook", "kicker_box_colour", "kicker pill colour")}
            />
          </div>
        </Group>

        <Group title="Position">
          <Segmented
            legend="Where"
            options={HOOK_POSITIONS}
            value={hook.position}
            onChange={(v) => set("hook", "position", v)}
            marker={marker("hook", "position", "hook position")}
            className="max-w-md"
          />
          {hook.position === "custom" && (
            <Slider label="Height of the hook's top" value={hook.y} min={232} max={1400} format={(v) => `${v} px`} onChange={(v) => set("hook", "y", v)} marker={marker("hook", "y", "hook height")} />
          )}
        </Group>

        <Group title="Animation">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Select label="Comes on" value={hook.animation_in} options={ANIMATIONS} onChange={(v) => set("hook", "animation_in", v)} marker={marker("hook", "animation_in", "how it comes on")} />
            <Select label="Goes off" value={hook.animation_out} options={ANIMATIONS} onChange={(v) => set("hook", "animation_out", v)} marker={marker("hook", "animation_out", "how it goes off")} />
            <Slider
              label="Length"
              value={hook.animation_ms}
              min={50}
              max={1000}
              step={50}
              format={(v) => `${(v / 1000).toFixed(2)} s`}
              onChange={(v) => set("hook", "animation_ms", v)}
              marker={marker("hook", "animation_ms", "animation length")}
            />
          </div>
        </Group>
      </fieldset>
    </div>
  );
}

/**
 * The Preset picker and its actions: reset the overrides, save the look as a new Preset, save it
 * into the Preset (the owner's only), or delete the Preset (the owner's only).
 */
function PresetBar({
  presets,
  preset,
  overridden,
  caption,
  hook,
  onPick,
  onReset,
  onSaved,
  onDeleted,
}: {
  presets: StylePreset[];
  preset: StylePreset;
  overridden: boolean;
  caption: CaptionStyle;
  hook: HookStyle;
  onPick: (id: string) => void;
  onReset: () => void;
  onSaved: (saved: StylePreset, all: StylePreset[]) => void;
  onDeleted: (all: StylePreset[]) => void;
}) {
  const id = useId();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const saveNew = () =>
    run(async () => {
      const made = await api.createPreset({ name, caption, hook });
      setNaming(false);
      setName("");
      onSaved(made, [...presets, made]);
    });
  const saveInto = () =>
    run(async () => {
      const updated = await api.updatePreset(preset.id, { name: preset.name, caption, hook });
      onSaved(updated, presets.map((p) => (p.id === updated.id ? updated : p)));
    });
  const remove = () =>
    run(async () => {
      await api.deletePreset(preset.id);
      setDeleting(false);
      onDeleted(presets.filter((p) => p.id !== preset.id));
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Style preset"
          value={preset.id}
          options={presets.map((p) => ({ value: p.id, label: p.builtin ? p.name : `${p.name} (yours)` }))}
          onChange={onPick}
          className="min-w-48 flex-1"
        />
        {overridden && (
          <Button size="sm" variant="ghost" onClick={onReset} disabled={busy}>
            <RotateCcw aria-hidden size={15} />
            Reset all
          </Button>
        )}
        {overridden && !preset.builtin && (
          <Button size="sm" onClick={() => void saveInto()} disabled={busy}>
            <Save aria-hidden size={15} />
            Update preset
          </Button>
        )}
        <Button size="sm" onClick={() => setNaming((open) => !open)} disabled={busy} aria-expanded={naming}>
          <Save aria-hidden size={15} />
          Save as new
        </Button>
        {!preset.builtin && (
          <Button size="sm" variant="ghost" onClick={() => setDeleting(true)} disabled={busy} aria-label={`Delete preset ${preset.name}`}>
            <Trash2 aria-hidden size={15} />
          </Button>
        )}
      </div>
      {naming && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void saveNew();
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              New preset's name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              maxLength={60}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              className="min-h-10 rounded-[10px] border border-border bg-fill px-3 text-base"
            />
          </div>
          <Button type="submit" size="sm" variant="primary" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save preset"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)} aria-label="Cancel">
            <X aria-hidden size={15} />
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <ConfirmDialog
        open={deleting}
        title={`Delete the preset “${preset.name}”?`}
        confirmLabel="Delete preset"
        busyLabel="Deleting…"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      >
        Clips using it will use Default from their next render.
      </ConfirmDialog>
    </div>
  );
}

// A titled group of the hook's fields.
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <legend className="float-left mb-1 text-sm font-semibold text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

// The preset bar and a section of fields, while the presets load.
function StyleSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <p role="status" className="sr-only">
        Loading the presets
      </p>
      <div aria-hidden className="flex flex-col gap-5">
        <Skeleton className="h-11 w-full" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-20 rounded-full" />
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((field) => (
              <Skeleton key={field} className="h-11" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
