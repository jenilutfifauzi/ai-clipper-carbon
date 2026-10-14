import { ScanSearch } from "lucide-react";
import type { Layout, LayoutOverride, RenderPlan, SceneLayout } from "../../../api";
import { Segmented } from "../../../components/Segmented";
import { cx, formatPrecise } from "../../../format";
import type { Geometry } from "./Timeline";

const LOOKS: Record<SceneLayout, string> = {
  track: "bg-accent/20 ring-accent/60",
  split: "bg-waiting-surface ring-waiting/60",
  blur: "bg-surface-raised ring-border",
  passthrough: "bg-surface-raised ring-border",
  fill: "bg-surface-raised ring-border",
};

const NAMES: Record<SceneLayout, string> = { track: "Track", split: "Split", blur: "Blur", passthrough: "As shot", fill: "Fill" };

// The override of the Scene from `start` to `end` (seconds into the Clip), as the planner finds it:
// the last one whose time is in it.
export function sceneOverride(overrides: LayoutOverride[], clipStart: number, start: number, end: number) {
  return overrides.filter((o) => o.at - clipStart >= start && o.at - clipStart < end).at(-1) ?? null;
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
        const changed = sceneOverride(overrides, clipStart, scene.start, scene.end) !== null;
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
] as const;

/** The picked Scene's Layout: the clip's (no override), or its own. */
export function SceneLayoutPicker({
  plan,
  index,
  clipStart,
  clipLayout,
  overrides,
  onChange,
}: {
  plan: RenderPlan;
  index: number;
  clipStart: number;
  clipLayout: Layout;
  overrides: LayoutOverride[];
  onChange: (overrides: LayoutOverride[]) => void;
}) {
  const scene = plan.scenes[index];
  if (!scene) return null;
  const current = sceneOverride(overrides, clipStart, scene.start, scene.end);
  const others = overrides.filter((o) => sceneOverride([o], clipStart, scene.start, scene.end) === null);
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-fill p-3">
      <Segmented
        legend={`Scene ${index + 1} of ${plan.scenes.length}, ${formatPrecise(scene.start)}–${formatPrecise(scene.end)} into the clip`}
        options={CHOICES}
        value={current?.layout ?? "default"}
        onChange={(value) =>
          onChange(
            value === "default"
              ? others
              : [...others, { at: Math.round((clipStart + (scene.start + scene.end) / 2) * 1000) / 1000, layout: value }].sort((a, b) => a.at - b.at),
          )
        }
      />
      <p className="text-sm text-muted">
        {current ? "This scene has its own layout." : `This scene follows the clip's layout (${clipLayout === "auto" ? "chosen by its faces" : clipLayout}).`}
      </p>
    </div>
  );
}
