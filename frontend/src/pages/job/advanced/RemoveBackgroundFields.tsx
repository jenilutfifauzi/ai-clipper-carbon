import { Download, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, FEATHER_MAX, type BackgroundRemoval, type MattePart, type PersonModelInfo } from "../../../api";
import { Button } from "../../../components/Button";
import { ProgressBar } from "../../../components/ProgressBar";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { formatBytes } from "../../../format";
import { Group, Mixed } from "../editor/StyleFields";
import { cuttableSegments, setBackgroundRemoval, setFeather } from "./actions";
import type { AdvancedEdits } from "./edits";
import { MatteSource, matteOf } from "./matte";
import type { Pick } from "./pick";
import { PersonModelSource, type PersonModelAction } from "./personModel";

/** The switch and feather of the picked Segments of the Source (`backgroundRemovalChanges`). */
export interface RemovalControls {
  // Each one's Background removal (null: off).
  removals: (BackgroundRemoval | null)[];
  // The ids of those cut out, whose Matte the section follows, and what they show (their ranges and
  // removals), so that a change of it reads the Matte again.
  cut: string[];
  shown: string;
  onSwitch: (on: boolean) => void;
  onFeather: (feather: number, group: string) => void;
}

/**
 * The Remove background section's controls for the picked Segments of the Source (ADR 0015): switching
 * Background removal on or off, and setting the feather, on all of them, each one change (a drag of
 * the feather one step of undo). Null without any (an Overlay's, a media Segment's come later).
 */
export function backgroundRemovalChanges(
  scene: { edits: AdvancedEdits; pick: Pick },
  onEdits: (edits: AdvancedEdits, group?: string) => void,
): RemovalControls | null {
  const segments = cuttableSegments(scene);
  if (!segments.length) return null;
  const cut = segments.filter((segment) => segment.background_removal);
  return {
    removals: segments.map((segment) => segment.background_removal ?? null),
    cut: cut.map((segment) => segment.id),
    shown: JSON.stringify(cut.map(({ id, start, end, hold, background_removal }) => [id, start, end, hold, background_removal])),
    onSwitch: (on) => {
      const outcome = setBackgroundRemoval(scene, on);
      if (outcome) onEdits(outcome.edits);
    },
    onFeather: (feather, group) => {
      const outcome = setFeather(scene, feather);
      if (outcome) onEdits(outcome.edits, `${group}:${segments.map((segment) => segment.id).join(",")}`);
    },
  };
}

/**
 * A Segment's or an Overlay's "Remove background" section (GLOSSARY.md, Background removal; ADR 0015),
 * on a desktop and in the phone's sheet: the picked Segments of the Source's switch and feather
 * (`removal`), their Matte's progress (MatteSource, of the Candidate `matte` names), and the person
 * model's state, read and polled while it downloads (PersonModelSource).
 */
export function RemoveBackground({ removal, matte }: { removal?: RemovalControls | null; matte?: { job: string; candidate: string } }) {
  const after = (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  };
  const [source] = useState(
    () =>
      new PersonModelSource({
        read: api.personModel,
        download: api.downloadPersonModel,
        cancel: api.cancelPersonModelDownload,
        remove: api.removePersonModel,
        after,
      }),
  );
  const [mattes] = useState(
    () =>
      new MatteSource({
        read: (retry) => (matte ? api.candidateMatte(matte.job, matte.candidate, retry) : Promise.reject(new Error("no Candidate"))),
        after,
      }),
  );
  const { model, message } = useSyncExternalStore(source.subscribe, () => source.state, () => source.state);
  const followed = useSyncExternalStore(mattes.subscribe, () => mattes.state, () => mattes.state);
  useEffect(() => {
    void source.load();
    return source.dispose;
  }, [source]);
  const cut = matte ? (removal?.cut ?? []) : [];
  const shown = matte ? (removal?.shown ?? "") : "";
  // Read again whenever the cut-out Segments change (`shown`), not on every render.
  useEffect(() => mattes.watch(cut), [mattes, shown]);
  useEffect(() => mattes.dispose, [mattes]);
  return (
    <RemoveBackgroundFields
      model={model}
      message={message}
      onAction={(action) => void source.act(action)}
      removal={removal}
      matte={matteOf(followed.matte, cut)}
      matteMessage={followed.message}
      onRetry={() => void mattes.retry()}
    />
  );
}

/**
 * The section's fields: with `removal`, the switch (Mixed when only some are on) and, once any is on,
 * the feather (0 to FEATHER_MAX px, shown as the first one's, Mixed when they differ), then their
 * Matte's progress ("Finding the subject… N%"), waiting for the person model, or failed with its
 * message and Retry. Then the person model: Download (its size and licence) while it isn't here; its
 * progress with Cancel while it downloads; Remove once it is here; a failed download's message with Retry.
 */
export function RemoveBackgroundFields({
  model,
  message,
  onAction,
  removal,
  matte = null,
  matteMessage = null,
  onRetry = () => {},
}: {
  // Null while its state is first read.
  model: PersonModelInfo | null;
  // Why its state couldn't be read, or an action was refused.
  message: string | null;
  onAction: (action: PersonModelAction) => void;
  removal?: RemovalControls | null;
  // The cut-out Segments' Matte together (matteOf); null with none cut out.
  matte?: MattePart | null;
  // Why it couldn't be read.
  matteMessage?: string | null;
  onRetry?: () => void;
}) {
  const told = [model?.state === "failed" ? model.message : null, message].filter(Boolean);
  const on = removal?.removals.filter((removal): removal is BackgroundRemoval => removal !== null) ?? [];
  const [first] = on;
  return (
    <Group title="Remove background">
      {removal && (
        <>
          <Switch checked={on.length === removal.removals.length} onChange={removal.onSwitch}>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Keep only the person
              {on.length > 0 && on.length < removal.removals.length && <Mixed />}
            </span>
          </Switch>
          {first && (
            <Slider
              label="Feather"
              value={first.feather}
              min={0}
              max={FEATHER_MAX}
              step={1}
              format={(value) => `${Math.round(value)} px`}
              marker={on.some((removal) => removal.feather !== first.feather) ? <Mixed /> : undefined}
              onChange={(feather) => removal.onFeather(feather, "background-removal:feather")}
            />
          )}
          {matte?.state === "making" ? (
            <>
              <div aria-live="polite" className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">Finding the subject…</span>
                <span className="text-muted tabular-nums">{`${Math.round(100 * matte.progress)}%`}</span>
              </div>
              <ProgressBar percent={100 * matte.progress} label="Finding the subject" />
            </>
          ) : matte?.state === "waiting" ? (
            <p role="status" className="text-sm text-pretty text-muted">
              The subject is found once the person model is downloaded.
            </p>
          ) : matte?.state === "failed" ? (
            <>
              <p role="status" className="text-sm text-pretty text-danger">{`Couldn't find the subject: ${matte.error ?? "unknown error"}`}</p>
              <Button size="sm" className="self-start" onClick={onRetry}>
                <RotateCcw aria-hidden size={16} />
                Retry finding the subject
              </Button>
            </>
          ) : matte?.state === "ready" ? (
            <p role="status" className="text-sm text-muted">
              Subject found.
            </p>
          ) : null}
          {matteMessage && (
            <p role="status" className="text-xs text-danger">
              {matteMessage}
            </p>
          )}
        </>
      )}
      {!model ? (
        <p role="status" className="text-sm text-muted">
          Checking the person model…
        </p>
      ) : model.state === "downloading" ? (
        <>
          <div aria-live="polite" className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">Downloading the person model…</span>
            <span className="text-muted tabular-nums">{`${Math.round(model.done / 1e6)} of ${formatBytes(model.total)}`}</span>
          </div>
          <ProgressBar percent={(100 * model.done) / Math.max(1, model.total)} label="Downloading the person model" />
          <Button size="sm" className="self-start" onClick={() => onAction("cancel")}>
            <X aria-hidden size={16} />
            Cancel the download
          </Button>
        </>
      ) : model.state === "ready" ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">{`${model.name} is on this Mac`}</span>
          <Button size="sm" variant="ghost" onClick={() => onAction("remove")}>
            <Trash2 aria-hidden size={16} />
            {`Remove person model (${formatBytes(model.total)})`}
          </Button>
        </div>
      ) : model.state === "failed" ? (
        <Button size="sm" className="self-start" onClick={() => onAction("download")}>
          <RotateCcw aria-hidden size={16} />
          Retry the download
        </Button>
      ) : (
        <>
          <span className="text-sm text-pretty text-muted">Keeps only the person, made on this Mac by a model downloaded once.</span>
          <Button size="sm" className="self-start" onClick={() => onAction("download")}>
            <Download aria-hidden size={16} />
            {`Download ${model.name.toLowerCase()} (${formatBytes(model.total)}, ${model.licence})`}
          </Button>
        </>
      )}
      {told.map((text) => (
        <p key={text} role="status" className="text-xs text-danger">
          {text}
        </p>
      ))}
    </Group>
  );
}
