import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, type AnchorKind, type CandidateChange, type CapturedTemplate, type SavedTemplate, type TemplateInfo } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { cx, formatPrecise } from "../../../format";
import { changeTemplates, useTemplates } from "../../../templates";
import { anchorOverrides, layerRows, rowKey, saveAsTemplate, type LayerRow } from "./templating";

// "Save over": none, a new Template.
const NEW = "";

const ANCHORS: { value: AnchorKind; label: string }[] = [
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "span", label: "Span" },
];

/**
 * "Save as Template…" (desktop only): the clip's draft as a Template, a new one or saved over one of
 * the owner's (which keeps its id). The capture preview gives each layer's guessed Anchor, which the
 * owner can change, and the notices of what is left out; its poster is the draft's frame at the
 * playhead (`at`, read when saving). `onSaved` tells what was saved.
 */
export function SaveTemplateDialog({
  open,
  jobId,
  candidateId,
  draft,
  at,
  onClose,
  onSaved,
}: {
  open: boolean;
  jobId: string;
  candidateId: string;
  draft: CandidateChange;
  at: () => number;
  onClose: () => void;
  onSaved: (saved: SavedTemplate, over: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const templates = useTemplates();
  const [name, setName] = useState("");
  const [over, setOver] = useState(NEW);
  const [captured, setCaptured] = useState<CapturedTemplate | null>(null);
  const [chosen, setChosen] = useState<Record<string, AnchorKind>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The draft as it was when the dialog opened: what is captured and saved.
  const opened = useRef(draft);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) return;
    opened.current = draft;
    setName("");
    setOver(NEW);
    setChosen({});
    setCaptured(null);
    setError(null);
    let current = true;
    api.captureTemplate({ job_id: jobId, candidate_id: candidateId, edits: draft }).then(
      (answer) => current && setCaptured(answer),
      (reason: Error) => current && setError(reason.message),
    );
    return () => void (current = false);
    // Captured once each time it opens, from the draft then.
  }, [open]);

  const rows = captured ? layerRows(captured) : [];
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await changeTemplates(() =>
        saveAsTemplate({ name, jobId, candidateId, draft: opened.current, anchors: anchorOverrides(rows, chosen), at: at() }, over || null),
      );
      onSaved(saved, !!over);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="save-template-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cx(
        "glass m-auto w-[min(36rem,calc(100%-2rem))] rounded-panel bg-bg/85! p-0 text-text backdrop:bg-black/50",
        "scale-100 opacity-100 starting:open:scale-95 starting:open:opacity-0",
        "motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:ease-out",
      )}
    >
      <div className="flex max-h-[min(90dvh,44rem)] flex-col">
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 id="save-template-title" className="text-lg font-semibold">
            Save as Template
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close">
            <X aria-hidden size={18} />
          </Button>
        </div>
        {open && (
          <SaveTemplateForm
            templates={templates ?? []}
            name={name}
            over={over}
            rows={captured ? rows : null}
            notices={captured?.notices ?? []}
            chosen={chosen}
            busy={busy}
            error={error}
            onName={setName}
            onOver={(id) => {
              setOver(id);
              const template = templates?.find((each) => each.id === id);
              if (template) setName(template.name);
            }}
            onAnchor={(row, anchor) => setChosen((old) => ({ ...old, [rowKey(row)]: anchor }))}
            onCancel={onClose}
            onSave={() => void save()}
          />
        )}
      </div>
    </dialog>
  );
}

/**
 * The save dialog's form: the name, "Save over" (a new Template, or one of the owner's), the layers
 * with their Anchors (the guess, or as `chosen`), the capture's notices, and Save. `rows` is null
 * while the capture preview is asked for.
 */
export function SaveTemplateForm({
  templates,
  name,
  over,
  rows,
  notices,
  chosen,
  busy,
  error,
  onName,
  onOver,
  onAnchor,
  onCancel,
  onSave,
}: {
  templates: TemplateInfo[];
  name: string;
  over: string;
  rows: LayerRow[] | null;
  notices: string[];
  chosen: Record<string, AnchorKind>;
  busy: boolean;
  error: string | null;
  onName: (name: string) => void;
  onOver: (id: string) => void;
  onAnchor: (row: LayerRow, anchor: AnchorKind) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const id = useId();
  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && rows && !busy) onSave();
      }}
    >
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pb-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={60}
            required
            autoFocus
            placeholder="Podcast — main"
            onChange={(event) => onName(event.target.value)}
            className="min-h-10 rounded-[10px] border border-border bg-fill px-3 text-base"
          />
        </div>
        {templates.length > 0 && (
          <Select
            label="Save over"
            value={over}
            onChange={onOver}
            options={[{ value: NEW, label: "No: a new Template" }, ...templates.map((template) => ({ value: template.id, label: template.name }))]}
          />
        )}
        <section aria-labelledby={`${id}-layers`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id={`${id}-layers`} className="text-sm font-medium">
              Layers
            </h3>
            <Hint more="Start keeps a layer's distance from the clip's own start, End from its end (before the outro), and Span stretches it to cover the clip.">
              Each keeps its place on a clip of another length by its Anchor, guessed from where it is.
            </Hint>
          </div>
          {rows === null ? (
            <p className="text-sm text-muted">Reading the layers…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted">No layers: the Template keeps the clip's style, intro and outro.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((row) => {
                const anchor = chosen[rowKey(row)] ?? row.guessed;
                return (
                  <li key={rowKey(row)} data-layer={rowKey(row)}>
                    <Segmented
                      legend={row.label}
                      marker={
                        <span className="font-normal text-muted tabular-nums">
                          {formatPrecise(row.start)}–{formatPrecise(row.start + row.secs)}
                          {anchor === row.guessed ? " · guessed" : ` · guessed ${ANCHORS.find((each) => each.value === row.guessed)!.label}`}
                        </span>
                      }
                      value={anchor}
                      onChange={(value) => onAnchor(row, value)}
                      options={ANCHORS}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {notices.length > 0 && (
          <ul aria-label="Notices" className="flex list-disc flex-col gap-1 pl-5 text-sm text-pretty text-muted">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
        <p className="text-sm text-pretty text-muted">Its poster is the frame at the playhead. Your unsaved changes are included.</p>
        {error && (
          <p role="alert" className="rounded-control bg-danger-surface p-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || rows === null}>
          {busy ? "Saving…" : over ? "Save over" : "Save Template"}
        </Button>
      </div>
    </form>
  );
}
