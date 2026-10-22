import { Download, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, type PersonModelInfo } from "../../../api";
import { Button } from "../../../components/Button";
import { ProgressBar } from "../../../components/ProgressBar";
import { formatBytes } from "../../../format";
import { Group } from "../editor/StyleFields";
import { PersonModelSource, type PersonModelAction } from "./personModel";

/**
 * A Segment's or an Overlay's "Remove background" section (GLOSSARY.md, Background removal; ADR 0015),
 * on a desktop and in the phone's sheet: the person model's state, read and polled while it downloads
 * (PersonModelSource). Its switch and feather come with the Matte.
 */
export function RemoveBackground() {
  const [source] = useState(
    () =>
      new PersonModelSource({
        read: api.personModel,
        download: api.downloadPersonModel,
        cancel: api.cancelPersonModelDownload,
        remove: api.removePersonModel,
        after: (ms, run) => {
          const timer = setTimeout(run, ms);
          return () => clearTimeout(timer);
        },
      }),
  );
  const { model, message } = useSyncExternalStore(source.subscribe, () => source.state, () => source.state);
  useEffect(() => {
    void source.load();
    return source.dispose;
  }, [source]);
  return <RemoveBackgroundFields model={model} message={message} onAction={(action) => void source.act(action)} />;
}

/**
 * The section's fields: Download (its size and licence) while the person model isn't here; its progress
 * with Cancel while it downloads; Remove once it is here; a failed download's message with Retry.
 */
export function RemoveBackgroundFields({
  model,
  message,
  onAction,
}: {
  // Null while its state is first read.
  model: PersonModelInfo | null;
  // Why its state couldn't be read, or an action was refused.
  message: string | null;
  onAction: (action: PersonModelAction) => void;
}) {
  const told = [model?.state === "failed" ? model.message : null, message].filter(Boolean);
  return (
    <Group title="Remove background">
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
