import { ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type Codec, type ExportPresetList, type ExportSettings } from "../../api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Segmented } from "../../components/Segmented";
import { Select } from "../../components/Select";
import { cx } from "../../format";
import { CODECS, QUALITIES } from "./exportPresets";

const CODEC_NOTES: Record<Codec, string> = { h264: "plays everywhere", hevc: "half the size", av1: "smallest, slower" };
const RESOLUTIONS = [720, 1080, 1440, 2160] as const;
const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const TIERS = ["high", "recommended", "smallest"] as const;
// A tier's size is shown for a minute at 30 fps when the Preset keeps the Source's rate.
const MINUTE = 60;
const SAME_AS_SOURCE_FPS = 30;
// The bitrate a Preset's own starts at when no tier's estimate is known, in kb/s; and its bounds.
const START_KBPS = 8000;
const MIN_KBPS = 100;
const MAX_KBPS = 200_000;
// The sound every Clip carries, in kb/s, taken off a tier's estimate to give its video bitrate.
const AUDIO_KBPS = 192;

interface Draft {
  name: string;
  settings: ExportSettings;
}

/**
 * The Export Presets sheet: the Presets on the left, the picked one's form on the right. A built-in
 * Preset's form is read-only, with "Duplicate" (and "Make default"); the owner's have Save, Delete
 * and "Make default" too. Each quality tier shows its size per minute, as the backend estimates it.
 * Opened from a Job (`sourceHeight`, the Source's effective height), a resolution above the Source's
 * says "Larger than the Source". Each change is saved at once, and `onChange` gets the Presets after it.
 */
export function ExportPresetsSheet({
  open,
  list,
  initial,
  sourceHeight,
  onClose,
  onChange,
}: {
  open: boolean;
  list: ExportPresetList;
  // The Preset shown first: the one picked on the Render button.
  initial: string;
  sourceHeight: number | null;
  onClose: () => void;
  onChange: (list: ExportPresetList) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [selectedId, setSelectedId] = useState(initial);
  const selected = list.presets.find((preset) => preset.id === selectedId) ?? list.presets[0];
  const [draft, setDraft] = useState<Draft>({ name: selected.name, settings: selected.settings });
  const [advanced, setAdvanced] = useState(selected.settings.bitrate !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Each tier's bytes per minute with the draft's codec, resolution and frame rate.
  const [perMinute, setPerMinute] = useState<Partial<Record<ExportSettings["quality"], number>>>({});

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) setSelectedId(initial);
  }, [open, initial]);
  // Another Preset picked, or this one saved: the form shows it as it is.
  useEffect(() => {
    setDraft({ name: selected.name, settings: selected.settings });
    setAdvanced(selected.settings.bitrate !== null);
    setError(null);
  }, [selected]);

  const { codec, resolution, fps } = draft.settings;
  useEffect(() => {
    if (!open) return;
    let current = true;
    setPerMinute({});
    for (const quality of TIERS) {
      const settings: ExportSettings = { ...draft.settings, quality, bitrate: null };
      api.estimateExport(settings, MINUTE, SAME_AS_SOURCE_FPS).then(
        (bytes) => current && setPerMinute((old) => ({ ...old, [quality]: bytes })),
        () => {},
      );
    }
    return () => void (current = false);
    // Only these change a tier's size.
  }, [open, codec, resolution, fps]);

  const set = (change: Partial<ExportSettings>) => setDraft((old) => ({ ...old, settings: { ...old.settings, ...change } }));
  const changed = draft.name !== selected.name || JSON.stringify(draft.settings) !== JSON.stringify(selected.settings);

  // Runs a change, then shows the Presets as they are after it: the one it answers, or the default
  // once the one shown is gone.
  async function act(change: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    try {
      const pick = await change();
      const after = await api.listExportPresets();
      onChange(after);
      if (pick) setSelectedId(pick);
      else if (!after.presets.some((preset) => preset.id === selected.id)) setSelectedId(after.default);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const duplicate = () =>
    act(async () => (await api.createExportPreset(`${draft.name} copy`.slice(0, 60), draft.settings)).id);
  const save = () => act(async () => void (await api.changeExportPreset(selected.id, draft.name.trim(), draft.settings)));
  const makeDefault = () => act(async () => void (await api.useExportPresetAsDefault(selected.id)));
  const remove = () =>
    act(async () => {
      await api.deleteExportPreset(selected.id);
      setDeleting(false);
    });

  // A bitrate of its own starts at what the tier aims for (its estimate less the sound).
  const tierKbps = perMinute[draft.settings.quality];
  const startKbps = tierKbps ? Math.round((tierKbps * 8) / MINUTE / 1000 - AUDIO_KBPS) : START_KBPS;
  const rate = draft.settings.bitrate?.mode ?? "tier";

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="glass m-auto w-[min(52rem,calc(100%-2rem))] rounded-panel bg-bg/85! p-0 text-text backdrop:bg-black/50"
    >
      <div className="flex max-h-[min(90dvh,48rem)] flex-col">
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            Export Presets
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close">
            <X aria-hidden size={18} />
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-6 pb-6 sm:grid-cols-[13rem_minmax(0,1fr)] sm:overflow-hidden">
          <nav aria-label="Export Presets" className="sm:overflow-y-auto">
            <ul className="flex flex-col gap-0.5">
              {list.presets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    aria-current={preset.id === selected.id ? "true" : undefined}
                    onClick={() => setSelectedId(preset.id)}
                    disabled={busy}
                    className={cx(
                      "flex min-h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-sm hover:bg-fill",
                      preset.id === selected.id && "bg-fill font-medium",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                    {preset.id === list.default && <span className="shrink-0 text-xs font-normal text-muted">Default</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <form
            className="flex min-w-0 flex-col gap-5 sm:overflow-y-auto sm:pr-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected.builtin && changed && draft.name.trim()) void save();
            }}
          >
            <fieldset disabled={selected.builtin || busy} aria-label="Export Settings" className="flex min-w-0 flex-col gap-5">
              {selected.builtin && <p className="text-sm text-muted">Built-in Presets can't be changed: duplicate one to make your own.</p>}
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-name`} className="text-sm font-medium">
                  Name
                </label>
                <input
                  id={`${id}-name`}
                  value={draft.name}
                  maxLength={60}
                  onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))}
                  className="min-h-10 rounded-[10px] border border-border bg-fill px-3 text-base disabled:opacity-60"
                />
              </div>

              <Choices
                legend="Codec"
                value={codec}
                onChange={(value) => set({ codec: value })}
                options={(["h264", "hevc", "av1"] as const).map((value) => {
                  const here = list.available.includes(value);
                  return { value, label: CODECS[value], note: here ? CODEC_NOTES[value] : "not on this Mac", unavailable: !here };
                })}
              />

              <Choices
                legend="Resolution"
                value={resolution}
                onChange={(value) => set({ resolution: value })}
                options={RESOLUTIONS.map((value) => ({
                  value,
                  label: value === 2160 ? "4K" : `${value}p`,
                  note: sourceHeight !== null && value > sourceHeight ? "Larger than the Source" : undefined,
                }))}
              />

              <Select
                label="Frame rate"
                value={fps === null ? "source" : String(fps)}
                onChange={(value) => set({ fps: value === "source" ? null : Number(value) })}
                options={[
                  { value: "source", label: "Same as Source" },
                  ...FRAME_RATES.map((rate) => ({ value: String(rate), label: `${rate} fps` })),
                ]}
              />

              <Choices
                legend="Quality"
                value={draft.settings.quality}
                onChange={(value) => set({ quality: value })}
                options={TIERS.map((value) => ({
                  value,
                  label: QUALITIES[value],
                  note: perMinute[value] !== undefined ? `${Math.round(perMinute[value] / 1e6)} MB per minute` : undefined,
                }))}
                hint={draft.settings.bitrate ? "A bitrate of its own (in Advanced) replaces the quality." : fps === null ? "Sizes at 30 fps." : undefined}
              />

              <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)} className="group border-t border-border pt-2">
                <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2 select-none hover:bg-fill [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    size={16}
                    className="shrink-0 text-muted group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"
                  />
                  <span className="shrink-0 font-semibold">Advanced</span>
                  <span className="min-w-0 truncate text-sm text-muted tabular-nums">
                    {draft.settings.bitrate ? `${draft.settings.bitrate.mode.toUpperCase()} ${draft.settings.bitrate.kbps} kb/s` : "Bitrate from the quality"}
                  </span>
                </summary>
                <div className="flex flex-col gap-4 pt-3 pb-1">
                  <Segmented
                    legend="Bitrate"
                    value={rate}
                    onChange={(mode) =>
                      set({ bitrate: mode === "tier" ? null : { mode, kbps: draft.settings.bitrate?.kbps ?? startKbps } })
                    }
                    options={[
                      { value: "tier", label: "From the quality" },
                      { value: "vbr", label: "VBR" },
                      { value: "cbr", label: "CBR" },
                    ]}
                  />
                  {draft.settings.bitrate && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${id}-kbps`} className="text-sm font-medium">
                        kb/s
                      </label>
                      <input
                        id={`${id}-kbps`}
                        type="number"
                        inputMode="numeric"
                        min={MIN_KBPS}
                        max={MAX_KBPS}
                        step={100}
                        required
                        value={draft.settings.bitrate.kbps}
                        onChange={(event) => set({ bitrate: { mode: draft.settings.bitrate!.mode, kbps: Number(event.target.value) } })}
                        className="min-h-10 w-40 rounded-[10px] border border-border bg-fill px-3 text-base tabular-nums"
                      />
                    </div>
                  )}
                </div>
              </details>

              <Segmented
                legend="Loudness"
                value={draft.settings.loudness === null ? "off" : String(draft.settings.loudness)}
                onChange={(value) => set({ loudness: value === "off" ? null : (Number(value) as -14 | -16) })}
                options={[
                  { value: "-14", label: "−14 LUFS" },
                  { value: "-16", label: "−16 LUFS" },
                  { value: "off", label: "Off" },
                ]}
              />
            </fieldset>

            {error && (
              <p role="alert" className="rounded-control bg-danger-surface p-3 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!selected.builtin && (
                <Button size="sm" variant="ghost" className="mr-auto" onClick={() => setDeleting(true)} disabled={busy}>
                  Delete
                </Button>
              )}
              {selected.id !== list.default && (
                <Button size="sm" onClick={() => void makeDefault()} disabled={busy}>
                  Make default
                </Button>
              )}
              <Button size="sm" onClick={() => void duplicate()} disabled={busy}>
                Duplicate
              </Button>
              {!selected.builtin && (
                <Button type="submit" size="sm" variant="primary" disabled={busy || !changed || !draft.name.trim()}>
                  Save
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        title={`Delete the Export Preset “${selected.name}”?`}
        confirmLabel="Delete preset"
        busyLabel="Deleting…"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      >
        {selected.id === list.default ? "“Shorts / TikTok / Reels” becomes the default. " : ""}
        Its Clips stay as they are, and render again with the default.
      </ConfirmDialog>
    </dialog>
  );
}

/** One choice of a few, each with a note beside it; one this Mac can't make is disabled. */
function Choices<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  hint,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; note?: string; unavailable?: boolean }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-col gap-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(
              "flex min-h-10 items-center gap-3 rounded-[10px] border border-border px-3 text-sm",
              "has-checked:border-accent has-checked:bg-fill has-enabled:cursor-pointer has-enabled:hover:bg-fill has-disabled:opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={value === option.value}
              disabled={option.unavailable}
              onChange={() => onChange(option.value)}
              className="accent-accent"
            />
            <span className="font-medium">{option.label}</span>
            {option.note && <span className="ml-auto text-right text-xs text-muted tabular-nums">{option.note}</span>}
          </label>
        ))}
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
