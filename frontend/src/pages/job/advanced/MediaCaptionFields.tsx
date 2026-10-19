import { RotateCw } from "lucide-react";
import { useId, useState } from "react";
import type { ClipSegment, MediaItem, WordsStatus } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { captionsOn, languageChoices, withCaptions, wordsState } from "./mediaCaptions";

/**
 * A video's Segment's captions (ADR 0020): its Captions switch, its video's language (which applies
 * to the video in every Job), and its Words status, with Retry when its transcription failed and
 * "Transcribe again" when it is ready.
 */
export function MediaCaptionFields({
  segment,
  item,
  job,
  status,
  error,
  onChange,
  onLanguage,
  onTranscribe,
}: {
  segment: ClipSegment;
  item: MediaItem;
  // The Job's language and whether it is captioned.
  job: { language: string; captions: boolean };
  // The Preview Plan's, for this Segment.
  status: WordsStatus | undefined;
  error: string | undefined;
  onChange: (segment: ClipSegment, group: string) => void;
  // Resolves once the video's language is set (null: each Job's).
  onLanguage: (language: string | null) => Promise<void>;
  // Resolves once its Media Words are queued again (a Retry, or with `again`, Transcribe again).
  onTranscribe: (again: boolean) => Promise<void>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!job.captions) return <p className="text-sm text-muted">Captions are off for this Job.</p>;
  const on = captionsOn(segment);
  const state = on ? wordsState(status, error) : null;
  const run = (work: Promise<void>) => {
    setBusy(true);
    setFailure(null);
    work.catch((reason: Error) => setFailure(reason.message)).finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-captions`} className="text-sm font-medium">
          Captions
        </span>
        <Switch checked={on} onChange={(next) => onChange(withCaptions(segment, next), `segment:${segment.id}:captions`)} labelledBy={`${id}-captions`}>
          <span className="text-sm text-muted">{on ? "On" : "Off"}</span>
        </Switch>
      </div>
      {on ? (
        <>
          <Select
            label="Language"
            value={item.language ?? ""}
            options={languageChoices(job.language, item.language)}
            disabled={busy}
            onChange={(language) => run(onLanguage(language || null))}
          />
          <Hint>The language applies to this video in every Job.</Hint>
          {state && (
            <div className="flex items-center justify-between gap-2">
              <p role={state.tone === "danger" ? "alert" : "status"} className={cx("min-w-0 text-sm", state.tone === "danger" ? "text-danger" : "text-muted")}>
                {state.text}
              </p>
              {state.action && (
                <Button size="sm" disabled={busy} onClick={() => run(onTranscribe(state.action === "again"))}>
                  <RotateCw aria-hidden size={14} />
                  {state.action === "again" ? "Transcribe again" : status === "failed" ? "Retry" : "Transcribe"}
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <Hint>No captions for this Segment, and its video isn't transcribed for it.</Hint>
      )}
      {failure && <p className="text-sm text-danger">{failure}</p>}
    </div>
  );
}
