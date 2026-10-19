import { Captions, Merge, RotateCcw, Scissors, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CueEdit, CueKey, PreviewPlan } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { CaptionTextEditor } from "../editor/CaptionTextEditor";
import { usePlayback, type Playback } from "../editor/playback";
import { Group } from "../editor/StyleFields";
import type { Outcome } from "./actions";
import {
  cueEditOf,
  cueOf,
  cueTimeGesture,
  deleteCue,
  mergeCue,
  nextCue,
  resetCueTiming,
  retypeCue,
  splitCue,
  splitPoint,
  wordsOfCue,
  type CueScene,
  type ShownCue,
} from "./cueEdits";
import { CuePlaceFields } from "./CuePlaceFields";
import { sameKey } from "../editor/timelineKey";
import type { AdvancedEdits } from "./edits";
import type { TrackKind } from "./trackState";

/**
 * A picked Cue: Split at the playhead, Merge with next and Delete; its Words as chips (the clip
 * editor's caption text editor) to retype, remove or start a line at; when it is shown, as fields
 * that move its edges; and Reset timing. Each is one step of undo, and refused while the Captions
 * Track is locked. Its edges and body are dragged on the Captions Track too.
 */
export function CueFields({
  cueKey,
  edits,
  preview,
  locked,
  playback,
  onCue,
}: {
  cueKey: CueKey;
  edits: AdvancedEdits;
  preview: PreviewPlan | null;
  locked: TrackKind[];
  playback: Playback;
  // An action's outcome applied: its edits as one change (of `group`, for a field's run of changes) and its Pick.
  onCue: (outcome: Outcome, group?: string) => void;
}) {
  const plan = preview?.plan ?? null;
  const scene: CueScene = { edits, plan, words: preview?.words, locked };
  // The fields' runs of changes, each from where the Cue was shown as it began.
  const [retime] = useState(cueTimeGesture);
  // The value last set in a field, shown while its Cue Edit is the one it wrote: the plan of it comes later.
  const [held, setHeld] = useState<{ edge: "start" | "end"; time: number; made: CueEdit | null } | null>(null);
  const splittable = usePlayback(playback, (time) => !!splitPoint(scene, cueKey, time));
  const cue = plan?.captions.find((other) => sameKey(other.key, cueKey));
  const shown = plan && cueOf(plan, cueKey);
  const reset = resetCueTiming(scene, cueKey);
  const merged = mergeCue(scene, cueKey);
  const deleted = deleteCue(scene, cueKey);
  const words = wordsOfCue(scene, cueKey);
  const run = (outcome: Outcome | null, group?: string) => outcome && onCue(outcome, group);
  const blocked = locked.includes("captions");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 font-semibold">
            <Captions aria-hidden size={17} className="shrink-0 text-muted" />
            Caption
          </h2>
          <CueActionButtons
            canSplit={splittable}
            canMerge={!!merged}
            canDelete={!!deleted}
            onSplit={() => run(splitCue(scene, cueKey, playback.time))}
            onMerge={() => run(merged)}
            onDelete={() => run(deleted)}
            mergeNote={plan && !blocked && !merged && nextCue(plan, cueKey) ? "The next caption wouldn't fit its lines." : undefined}
          />
        </div>
        {cue && <p className="text-sm text-pretty break-words">“{cue.plain.join(" ")}”</p>}
        <Hint more="Drag its edges to show it earlier or later at either end, or its middle to move it with its highlight. It stays between the captions either side of it.">
          Retime it on the Captions Track.
        </Hint>
      </div>
      {preview && !blocked && (
        <CaptionTextEditor
          preview={preview}
          only={words}
          edits={edits.word_edits}
          playback={playback}
          onChange={(next) => run(retypeCue(scene, cueKey, next))}
        />
      )}
      {shown && (
        <CueTimeFields
          shown={held && plan && held.made === cueEditOf(edits.cue_edits, plan, cueKey) ? { ...shown, [held.edge]: held.time } : shown}
          disabled={blocked}
          onTime={(edge, time) => {
            const outcome = retime(scene, cueKey, edge, time);
            if (!outcome || !plan) return;
            run(outcome, `cue:${edge}`);
            setHeld({ edge, time, made: cueEditOf(outcome.edits.cue_edits, plan, cueKey) });
          }}
        />
      )}
      <Button size="sm" className="self-start" disabled={!reset} onClick={() => run(reset)}>
        <RotateCcw aria-hidden size={16} />
        Reset timing
      </Button>
      {!blocked && <CuePlaceFields cueKey={cueKey} edits={edits} plan={plan} onEdits={(next, group) => onCue({ edits: next, pick: { kind: "cue", key: cueKey } }, group)} />}
    </div>
  );
}

/** Split, Merge with next and Delete, as the Segment inspector's buttons are: each disabled when it can't be done. */
export function CueActionButtons({
  canSplit,
  canMerge,
  canDelete,
  onSplit,
  onMerge,
  onDelete,
  mergeNote,
}: {
  canSplit: boolean;
  canMerge: boolean;
  canDelete: boolean;
  onSplit: () => void;
  onMerge: () => void;
  onDelete: () => void;
  // Why Merge is disabled, when the next Cue doesn't fit.
  mergeNote?: string;
}) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="icon" onClick={onSplit} disabled={!canSplit} aria-label="Split at the playhead" title="Split at the playhead">
        <Scissors aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={onMerge} disabled={!canMerge} aria-label="Merge with next" title={mergeNote ?? "Merge with next"}>
        <Merge aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete} disabled={!canDelete} aria-label="Delete its words" title="Delete its words">
        <Trash2 aria-hidden size={17} />
      </Button>
    </div>
  );
}

/**
 * A shown Cue's start and end as fields: each kept as the planner keeps it (from `low`, to `high`,
 * `minSecs` long at least), and set by `onTime` (which writes that edge's delta).
 */
export function CueTimeFields({
  shown,
  disabled,
  onTime,
}: {
  shown: ShownCue;
  disabled?: boolean;
  onTime: (edge: "start" | "end", time: number) => void;
}) {
  const seconds = (value: number) => `${value.toFixed(2)} s`;
  return (
    <Group title="Time">
      <Slider
        label="Starts"
        value={shown.start}
        min={Math.min(shown.low, shown.start)}
        max={Math.max(shown.start, shown.end - shown.minSecs)}
        step={0.01}
        format={seconds}
        disabled={disabled}
        onChange={(time) => onTime("start", time)}
      />
      <Slider
        label="Ends"
        value={shown.end}
        min={Math.min(shown.end, shown.start + shown.minSecs)}
        max={Math.max(shown.end, shown.high)}
        step={0.01}
        format={seconds}
        disabled={disabled}
        onChange={(time) => onTime("end", time)}
      />
    </Group>
  );
}
