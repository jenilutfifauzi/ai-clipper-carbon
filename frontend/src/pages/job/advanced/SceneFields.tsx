import { Crop as CropIcon } from "lucide-react";
import type { Framing, Layout, RenderPlan } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { forAllScenes, framingSource, reframed, sceneLayoutOverrides, sourceSceneAt, withClipLayout, withSceneFraming, type LayoutEdits } from "../editor/manual";
import { usePlayback, type Playback } from "../editor/playback";
import { sceneOverride } from "../editor/ScenesTrack";
import { Group } from "../editor/StyleFields";
import { BackgroundFields, TransformFields } from "./TransformFields";

const LAYOUTS: readonly { value: Layout; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "track", label: "Track" },
  { value: "split", label: "Split" },
  { value: "blur", label: "Blur" },
  { value: "manual", label: "Manual" },
];

const NAMES: Record<Layout, string> = { auto: "Auto", track: "Track", split: "Split", blur: "Blur", manual: "Manual" };

/**
 * How the Scene under the playhead, in the picked Source Segment `index` (of a Main Track of
 * `count`), is framed: its Layout (the clip's, or its own Layout Override) and the clip's. An
 * automatic Scene can be reframed by hand: Manual, from what it shows (docs/adr/0007). A Manual
 * Scene shows its Framing (its Transform, Crop and Background), its own ("This Scene", which can be
 * used for all Scenes) or the clip's ("All Scenes", which can be split off for this Scene only).
 * Each field is one group of the history, named after the Framing's owner and the field.
 */
export function SceneFields<T extends LayoutEdits>({
  plan,
  index,
  count,
  playback,
  edits,
  onEdits,
}: {
  plan: RenderPlan | null;
  index: number;
  count: number;
  playback: Playback;
  edits: T;
  onEdits: (edits: T, group?: string) => void;
}) {
  const at = usePlayback(playback, (time) => (plan ? sourceSceneAt(plan, index, count, time) : null));
  if (!plan) return null;
  const scene = at === null ? undefined : plan.scenes[at];
  if (at === null || !scene) {
    return (
      <Group title="Scene">
        <p className="text-sm text-pretty text-muted">Put the playhead on this Segment to change how its Scene there is framed.</p>
      </Group>
    );
  }
  if (scene.layout === "passthrough") {
    return (
      <Group title="Scene">
        <p className="text-sm text-pretty text-muted">A portrait episode is shown as it was shot.</p>
      </Group>
    );
  }
  const own = sceneOverride(edits.layout_overrides, plan, at);
  const source = framingSource(edits, plan, at);
  const apply = (next: LayoutEdits | null, group?: string) => next && onEdits({ ...edits, ...next }, group);
  // The history group of a field of the Framing, by where it is kept: the override's time, or the clip.
  const owner = source?.own ? `layout:${source.own.at}` : "layout:clip";
  const setFraming = (framing: Framing, field: string) => apply(withSceneFraming(edits, plan, at, framing), `${owner}:${field}`);
  return (
    <Group title={`Scene ${at + 1} at the playhead`}>
      <Select
        label="This Scene's layout"
        value={own?.layout ?? "default"}
        options={[{ value: "default", label: `The clip's (${NAMES[edits.layout]})` }, ...LAYOUTS]}
        onChange={(layout: Layout | "default") => {
          const layout_overrides = sceneLayoutOverrides(edits.layout_overrides, plan, at, layout);
          if (layout_overrides) apply({ ...edits, layout_overrides });
        }}
      />
      <Select label="The clip's layout" value={edits.layout} options={LAYOUTS} onChange={(layout: Layout) => apply(withClipLayout(edits, plan, at, layout))} />
      {source ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{source.own ? "This Scene" : "All Scenes"}</p>
            <Button size="sm" onClick={() => apply(source.own ? forAllScenes(edits, plan, at) : reframed(edits, plan, at))}>
              {source.own ? "Use for all Scenes" : "Only this Scene"}
            </Button>
          </div>
          <TransformFields
            transform={source.framing.transform}
            crop={source.framing.crop}
            size={{ width: plan.source_width, height: plan.source_height }}
            onChange={(transform, field) => setFraming({ ...source.framing, transform }, `transform.${field}`)}
            onCrop={(crop, field) => setFraming({ ...source.framing, crop }, `crop.${field}`)}
          />
          <BackgroundFields background={source.framing.background} onChange={(background, field) => setFraming({ ...source.framing, background }, `background.${field}`)} />
        </>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <Button size="sm" onClick={() => apply(reframed(edits, plan, at))}>
            <CropIcon aria-hidden size={16} />
            Reframe by hand
          </Button>
          <Hint more="It stays where you put it for the whole Scene: faces aren't followed there.">
            Frames this Scene yourself, starting from what it shows now.
          </Hint>
        </div>
      )}
    </Group>
  );
}
