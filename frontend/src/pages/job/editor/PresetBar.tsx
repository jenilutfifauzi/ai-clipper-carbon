import { RotateCcw, Save, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { api } from "../../../api";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Select } from "../../../components/Select";
import { Skeleton } from "../../../components/Skeleton";
import type { StyleControls } from "./useStyleDraft";

/**
 * The Style Preset picker and its actions, above the editor's tabs: a Preset sets the captions and
 * the hook together. Reset the overrides, save the look as a new Preset, save it into the Preset
 * (the owner's only), or delete the Preset (the owner's only).
 */
export function PresetBar({ style, error: loadError }: { style: StyleControls | null; error: string | null }) {
  const id = useId();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!style) {
    if (loadError) return <p className="text-sm text-muted">Couldn't load the presets: {loadError}</p>;
    // The picker's label and field, and its hint, so nothing shifts when the Presets arrive.
    return (
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-3/4 rounded-full" />
        <Skeleton className="h-9 w-28" />
      </div>
    );
  }
  const { presets, preset, caption, hook } = style;
  const overridden = Object.keys(style.overrides.caption).length + Object.keys(style.overrides.hook).length > 0;

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
      style.saved(made, [...presets, made]);
    });
  const saveInto = () =>
    run(async () => {
      const updated = await api.updatePreset(preset.id, { name: preset.name, caption, hook });
      style.saved(updated, presets.map((p) => (p.id === updated.id ? updated : p)));
    });
  const remove = () =>
    run(async () => {
      await api.deletePreset(preset.id);
      setDeleting(false);
      style.deleted(presets.filter((p) => p.id !== preset.id));
    });

  return (
    <div className="flex flex-col gap-2">
      {/* The picker, with Delete beside it (away from the saves) for the owner's Presets. */}
      <div className="flex items-end gap-2">
        <Select
          label="Style preset"
          value={preset.id}
          options={presets.map((p) => ({ value: p.id, label: p.builtin ? p.name : `${p.name} (yours)` }))}
          onChange={style.pick}
          className="flex-1"
        />
        {!preset.builtin && (
          <Button size="sm" variant="ghost" className="w-10" onClick={() => setDeleting(true)} disabled={busy} aria-label={`Delete preset ${preset.name}`}>
            <Trash2 aria-hidden size={15} />
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">Sets the captions and the hook together.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" onClick={() => setNaming((open) => !open)} disabled={busy} aria-expanded={naming}>
          <Save aria-hidden size={15} />
          Save as new
        </Button>
        {overridden && !preset.builtin && (
          <Button size="xs" onClick={() => void saveInto()} disabled={busy} aria-label={`Update preset ${preset.name}`} title="Save these changes into the preset">
            <Save aria-hidden size={15} />
            Update
          </Button>
        )}
        {overridden && (
          <Button size="xs" variant="ghost" onClick={style.resetAll} disabled={busy}>
            <RotateCcw aria-hidden size={15} />
            Reset all
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
