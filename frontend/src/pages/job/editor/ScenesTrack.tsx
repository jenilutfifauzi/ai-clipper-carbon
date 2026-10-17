import { ScanSearch } from "lucide-react";
import type { Layout, LayoutOverride, RenderPlan, SceneLayout } from "../../../api";
import { Segmented } from "../../../components/Segmented";
import { cx, formatPrecise } from "../../../format";
import { offeredLayouts, portraitSource, shownLayout } from "./layouts";
import { playedSourceAt, sourceAt } from "./segmentTime";
import type { Geometry } from "./Timeline";

const LOOKS: Record<SceneLayout, string> = {
  track: "bg-accent/20 ring-accent/60",
  split: "bg-waiting-surface ring-waiting/60",
  blur: "bg-surface-raised ring-border",
  passthrough: "bg-surface-raised ring-border",
  media: "bg-surface-raised ring-border",
  manual: "bg-fill ring-text/40",
};

const NAMES: Record<SceneLayout, string> = { track: "Track", split: "Split", blur: "Blur", passthrough: "As shot", media: "Video", manual: "Manual" };

/**
 * Where `time` (seconds into the Clip) of the plan's Scene `scene` is on the Source's timeline: in
 * a Clip of one range, from its start; in a cut one, from the start of the Segment the Scene is in
 * (docs/adr/0002-segments-and-timeline-time.md). Null in a Media Library video's Segment, which has
 * no Source time (and no Layout Overrides).
 */
export function sourceTime(plan: RenderPlan, scene: number, time: number): number | null {
  if (!plan.segments.length) return sourceAt(plan, time);
  let first = 0;
  for (const segment of plan.segments) {
    if (scene < first + segment.scenes) return segment.media ? null : playedSourceAt(segment, time);
    first += segment.scenes;
  }
  return null;
}

/**
 * The plan's Scene at `time`: of the Segment `segment` (the one playing), when the Clip is cut, so
 * that where a Transition overlaps two Segments the one playing shows.
 */
export function sceneAt(plan: RenderPlan, time: number, segment = 0): number {
  if (plan.segments.length) {
    const first = plan.segments.slice(0, segment).reduce((count, other) => count + other.scenes, 0);
    const count = plan.segments[segment]?.scenes ?? 1;
    for (let i = first; i < first + count - 1; i++) if (time < plan.scenes[i].end) return i;
    return Math.min(first + count - 1, plan.scenes.length - 1);
  }
  const index = plan.scenes.findIndex((scene) => time < scene.end);
  return index === -1 ? plan.scenes.length - 1 : index;
}

// The override of the plan's Scene `index`, as the planner finds it: the last one whose time (on
// the Source's timeline) is in it.
export function sceneOverride(overrides: LayoutOverride[], plan: RenderPlan, index: number) {
  const scene = plan.scenes[index];
  const start = sourceTime(plan, index, scene.start);
  const end = sourceTime(plan, index, scene.end);
  if (start === null || end === null) return null;
  return overrides.filter((o) => o.at >= start && o.at < end).at(-1) ?? null;
}

/** The plan's Scenes on the timeline, coloured by Layout; a click picks one to change its Layout. */
export function ScenesTrack({
  plan,
  geometry,
  analysed,
  overrides,
  selected,
  preparing,
  onSelect,
  onPrepare,
}: {
  plan: RenderPlan | null;
  geometry: Geometry;
  analysed: boolean;
  overrides: LayoutOverride[];
  selected: number | null;
  preparing: boolean;
  onSelect: (index: number) => void;
  onPrepare: () => void;
}) {
  if (!plan) return null;
  const { viewStart, pps, clipStart } = geometry;
  return (
    <>
      {plan.scenes.map((scene, i) => {
        const changed = sceneOverride(overrides, plan, i) !== null;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            aria-pressed={selected === i}
            aria-label={`Scene ${i + 1}, ${NAMES[scene.layout]}${changed ? ", changed" : ""}`}
            className={cx(
              "absolute inset-y-1 overflow-hidden rounded-md px-1 text-left text-xs leading-7 whitespace-nowrap ring-1",
              "focus-visible:outline-2 focus-visible:outline-focus",
              LOOKS[scene.layout],
              selected === i && "ring-2 ring-text",
            )}
            style={{ left: (clipStart + scene.start - viewStart) * pps, width: Math.max(2, (scene.end - scene.start) * pps - 1) }}
          >
            {changed && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-accent align-middle" />}
            {NAMES[scene.layout]}
          </button>
        );
      })}
      {!analysed && (
        <button
          type="button"
          onClick={onPrepare}
          disabled={preparing}
          className="sticky left-[76px] z-10 ml-1 inline-flex h-7 translate-y-1 items-center gap-1 rounded-md bg-surface px-2 text-xs font-medium ring-1 ring-border hover:bg-fill disabled:opacity-60"
        >
          <ScanSearch aria-hidden size={13} />
          {preparing ? "Finding scenes…" : "Find scenes and faces"}
        </button>
      )}
    </>
  );
}

const CHOICES = [
  { value: "default", label: "Clip's" },
  { value: "auto", label: "Auto" },
  { value: "track", label: "Track" },
  { value: "split", label: "Split" },
  { value: "blur", label: "Blur" },
  { value: "manual", label: "Manual" },
] as const;

/**
 * The picked Scene's Layout: the clip's (no override), or its own. `onChange` gets the choice, for
 * the editor to make the Layout Overrides of (`sceneLayoutOverrides`, which Manual's Framing needs).
 */
export function SceneLayoutPicker({
  plan,
  index,
  clipLayout,
  overrides,
  onChange,
}: {
  plan: RenderPlan;
  index: number;
  clipLayout: Layout;
  overrides: LayoutOverride[];
  onChange: (layout: Layout | "default") => void;
}) {
  const scene = plan.scenes[index];
  if (!scene) return null;
  const middle = sourceTime(plan, index, (scene.start + scene.end) / 2);
  if (middle === null) {
    return <p className="rounded-control bg-fill p-3 text-sm text-muted">A video's Segment: how it fills the frame is set in the Advanced Edit.</p>;
  }
  const current = sceneOverride(overrides, plan, index);
  const portrait = portraitSource(plan);
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-fill p-3">
      <Segmented
        legend={`Scene ${index + 1} of ${plan.scenes.length}, ${formatPrecise(scene.start)}–${formatPrecise(scene.end)} into the clip`}
        options={offeredLayouts(CHOICES, portrait)}
        value={shownLayout(current?.layout ?? "default", portrait)}
        onChange={onChange}
      />
      <p className="text-sm text-muted">
        {current?.layout === "manual"
          ? "This scene is framed by hand: drag its picture on the preview to pan it, its corners to zoom."
          : current
            ? "This scene has its own layout."
            : portrait && clipLayout !== "manual"
              ? "A portrait episode is shown as it was shot. Choose Manual to frame this scene by hand."
              : `This scene follows the clip's layout (${clipLayout === "auto" ? "chosen by its faces" : clipLayout}).`}
      </p>
    </div>
  );
}
