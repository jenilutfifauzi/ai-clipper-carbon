import { Check, MoreHorizontal, Plus, Save, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { FontInfo, TextPreset, TextStyle } from "../../../api";
import { Button, buttonClass } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Hint } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { fontFamily } from "../../../fonts";
import { chooseForNewTitles, deleteTextPreset, forNewTitles, renameTextPreset, saveTextPreset, shelvesOf, useTextPresets } from "../../../textPresets";
import { ImportFont } from "../editor/ImportFont";
import { IDENTITY } from "../editor/picture";
import { shadowOffset, shadowOn } from "../editor/shadow";
import { DRAG_TEXT } from "./drag";
import type { UntimedTextLayer } from "./TextLayers";

/** What a Text Layer made from `preset` is: its sample text in its Text Style, a copy, at the frame's centre and without animations. */
export function fromPreset(preset: TextPreset): UntimedTextLayer {
  return { text: preset.sample, transform: IDENTITY, style: preset.style, animation_in: "none", animation_out: "none", animation_ms: 300 };
}

/**
 * The Text tab: Add text, in the Preset used for new titles; the Presets on their shelves ("Mine",
 * then the built-in ones by kind), each drawn in its Text Style and adding a Text Layer at the playhead,
 * or where it is dropped on the timeline; and Import font, whose Faces every font picker then lists.
 */
export function TextAssets({ fonts, onAdd }: { fonts: FontInfo[] | null; onAdd: (made: UntimedTextLayer) => void }) {
  const presets = useTextPresets();
  const forNew = presets && forNewTitles(presets);
  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" size="sm" className="self-start" disabled={!forNew} onClick={() => forNew && onAdd(fromPreset(forNew))}>
        <Plus aria-hidden size={16} />
        Add text
      </Button>
      <Hint more="Drag a text on the video to place it. A preset's menu sets the one Add text uses.">
        Click a look to add it at the playhead, or drag it onto the timeline.
      </Hint>
      {presets === null && <p className="text-sm text-muted">Loading the looks…</p>}
      {presets &&
        shelvesOf(presets).map((shelf) => (
          <section key={shelf.category} className="flex flex-col gap-2" aria-label={shelf.category}>
            <h3 className="text-sm font-medium text-muted">{shelf.category}</h3>
            <div className="grid grid-cols-2 gap-2">
              {shelf.presets.map((preset) => (
                <PresetTile key={preset.id} preset={preset} fonts={fonts} onAdd={() => onAdd(fromPreset(preset))} />
              ))}
            </div>
          </section>
        ))}
      <ImportFont />
    </div>
  );
}

// The size a tile draws its sample at (text-lg), in CSS pixels.
const TILE_SIZE = 18;

// How a Preset's sample is drawn on its tile: its Face, colours, stroke, shadow and plate, scaled to the tile's size.
function sampleStyle(style: TextStyle, fonts: FontInfo[] | null): CSSProperties {
  const by = TILE_SIZE / style.size;
  const { shadow, plate } = style;
  const offset = shadowOffset(shadow);
  const px = (value: number) => `${Math.round(value * by * 10) / 10}px`;
  return {
    fontFamily: fonts?.some((font) => font.id === style.font) ? fontFamily(style.font) : undefined,
    color: style.colour,
    backgroundColor: plate.shape !== "none" && plate.opacity > 0 ? `color-mix(in srgb, ${plate.colour} ${Math.round(plate.opacity * 100)}%, transparent)` : undefined,
    WebkitTextStroke: style.stroke_width ? `1px ${style.stroke_colour}` : undefined,
    textShadow: shadowOn(shadow)
      ? `${px(offset.x)} ${px(offset.y)} ${px(shadow.blur)} color-mix(in srgb, ${shadow.colour} ${Math.round(shadow.opacity * 100)}%, transparent)`
      : undefined,
  };
}

// The menu's distance from its button, and from the window's edges.
const GAP_PX = 4;
const EDGE_PX = 8;

/** One Preset on its shelf: a button that adds it, and its menu (Use for new titles; Rename and Delete for the owner's). */
function PresetTile({ preset, fonts, onAdd }: { preset: TextPreset; fonts: FontInfo[] | null; onAdd: () => void }) {
  const more = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The menu is a popover in the top layer, so that the scrolling panel doesn't clip it; light dismiss and Escape close it.
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggled = (event: Event) => setOpen((event as ToggleEvent).newState === "open");
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, [renaming]);

  function show() {
    const anchor = more.current?.getBoundingClientRect();
    const element = menu.current;
    if (!anchor || !element) return;
    element.showPopover();
    // Under the button, its right edge at the button's, kept in the window.
    const left = Math.min(Math.max(anchor.right - element.offsetWidth, EDGE_PX), window.innerWidth - element.offsetWidth - EDGE_PX);
    const below = anchor.bottom + GAP_PX;
    const top = below + element.offsetHeight > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - element.offsetHeight : below;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }
  const hide = () => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      hide();
      setRenaming(false);
      setDeleting(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (renaming) {
    return (
      <div className="col-span-2">
        <NameForm label={`Rename “${preset.name}”`} initial={preset.name} busy={busy} onSave={(name) => void run(() => renameTextPreset(preset.id, name))} onCancel={() => setRenaming(false)} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TEXT, preset.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onClick={onAdd}
        title={preset.name}
        className="raised flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-[10px] p-2 hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="max-w-full truncate rounded-md px-1.5 text-lg leading-tight" style={sampleStyle(preset.style, fonts)}>
          {preset.sample}
        </span>
        {preset.sample !== preset.name && <span className="max-w-full truncate text-xs text-muted">{preset.name}</span>}
        {preset.default && <span className="sr-only">(used for new titles)</span>}
      </button>
      {preset.default && <Check aria-hidden size={14} className="absolute top-1.5 left-1.5 text-accent-text" />}
      <button
        ref={more}
        type="button"
        className={buttonClass("ghost", "icon", "absolute -top-1.5 -right-1.5 size-9!")}
        aria-label={`More for ${preset.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? hide() : show())}
      >
        <MoreHorizontal aria-hidden size={16} />
      </button>
      <div
        ref={menu}
        role="menu"
        aria-label={preset.name}
        {...{ popover: "auto" }}
        className="glass fixed inset-auto m-0 min-w-44 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
      >
        <MenuItem disabled={busy || preset.default} onClick={() => void run(() => chooseForNewTitles(preset.id))}>
          {preset.default ? "Used for new titles" : "Use for new titles"}
        </MenuItem>
        {!preset.builtin && (
          <>
            <MenuItem disabled={busy} onClick={() => (hide(), setRenaming(true))}>
              Rename
            </MenuItem>
            <MenuItem disabled={busy} danger onClick={() => (hide(), setDeleting(true))}>
              Delete
            </MenuItem>
          </>
        )}
        {error && !deleting && <p className="px-2 py-1 text-sm text-danger">{error}</p>}
      </div>
      <ConfirmDialog
        open={deleting}
        title={`Delete the look “${preset.name}”?`}
        confirmLabel="Delete look"
        busyLabel="Deleting…"
        busy={busy}
        error={error}
        onConfirm={() => void run(() => deleteTextPreset(preset.id))}
        onCancel={() => setDeleting(false)}
      >
        Texts already made in it keep their look.{preset.default ? " New titles go back to Text." : ""}
      </ConfirmDialog>
    </div>
  );
}

function MenuItem({ children, danger, disabled, onClick }: { children: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-9 rounded-md px-2 text-left text-sm hover:bg-fill disabled:opacity-60 disabled:hover:bg-transparent ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

/** A name to save or rename a Preset under. */
function NameForm({ label, initial = "", busy, onSave, onCancel }: { label: string; initial?: string; busy: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const id = useId();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <input
          id={id}
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          className="min-h-10 rounded-[10px] border border-border bg-fill px-3 text-base"
        />
      </div>
      <Button type="submit" size="sm" variant="primary" disabled={busy || !name.trim()}>
        {busy ? "Saving…" : "Save"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel">
        <X aria-hidden size={15} />
      </Button>
    </form>
  );
}

/** Save as Text Preset: a Text Layer's Text Style kept under Mine in the Text tab, by a name. */
export function SaveAsTextPreset({ style }: { style: TextStyle }) {
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(name: string) {
    setBusy(true);
    setError(null);
    try {
      await saveTextPreset(name, style);
      setSaved(name);
      setNaming(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {naming ? (
        <NameForm label="Text preset's name" busy={busy} onSave={(name) => void save(name)} onCancel={() => setNaming(false)} />
      ) : (
        <Button size="xs" className="self-start" onClick={() => (setNaming(true), setSaved(null))}>
          <Save aria-hidden size={15} />
          Save as Text Preset
        </Button>
      )}
      {saved && (
        <p className="text-sm text-muted" aria-live="polite">
          Saved “{saved}” under Mine in the Text tab.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Apply look (in the owner's words): the picked Text Layers given a Preset's Text Style, their words, places and Keyframes kept. */
export function ApplyTextPreset({ onApply }: { onApply: (style: TextStyle) => void }) {
  const presets = useTextPresets();
  const options = [{ value: "", label: "Choose a look…" }, ...(presets ?? []).map((preset) => ({ value: preset.id, label: preset.builtin ? preset.name : `${preset.name} (yours)` }))];
  return (
    <Select
      label="Apply look"
      value=""
      options={options}
      disabled={!presets?.length}
      onChange={(id) => {
        const preset = presets?.find((p) => p.id === id);
        if (preset) onApply(preset.style);
      }}
    />
  );
}
