import { Crop as CropIcon } from "lucide-react";
import type { Crop, Framing, Layout, RenderPlan, Transform } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { forAllScenes, framingSource, reframed, sceneLayoutOverrides, sourceSceneAt, withClipLayout, withSceneFraming, type LayoutEdits } from "../editor/manual";
import { offeredLayouts, portraitSource, shownLayout } from "../editor/layouts";
import { PICTURE_KEYS } from "../editor/keyframes";
import { canvasOf } from "../editor/canvas";
import { identity } from "../editor/picture";
import { usePlayback, type Playback } from "../editor/playback";
import { sceneOverride } from "../editor/ScenesTrack";
import { Group } from "../editor/StyleFields";
import { shownTransform } from "./keyActions";
import { useKeyNotice, useKeyTime } from "./KeyCluster";
import { heldKeyTime, keyedGroup, keyTime, manualScene, sceneRef, withSceneTransform } from "./keying";
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
 * Each field is one group of the history, named after the Framing's owner and the field. A portrait
 * episode is shown as it was shot (Auto, "As shot") unless a Scene is framed by hand.
 *
 * A Scene's own Manual Framing can be keyed (ADR 0008): its Transform is shown as it is at the
 * playhead, its X, Y, Scale, Rotation and Opacity have their ‹ ◆ ›, a keyed one is set as a Keyframe
 * there (in seconds from its Scene's start on the Source's timeline), and Reset drops them. The
 * clip's Framing, every Scene's without its own, has none.
 */
export function SceneFields<T extends LayoutEdits>({
  plan,
  index,
  count,
  playback,
  edits,
  onEdits,
  onCropMode,
}: {
  plan: RenderPlan | null;
  index: number;
  count: number;
  playback: Playback;
  edits: T;
  onEdits: (edits: T, group?: string) => void;
  // A Manual Scene's Crop mode on the stage, when it can be opened there.
  onCropMode?: () => void;
}) {
  const at = usePlayback(playback, (time) => (plan ? sourceSceneAt(plan, index, count, time) : null));
  const time = useKeyTime(playback);
  const notify = useKeyNotice();
  if (!plan) return null;
  const scene = at === null ? undefined : plan.scenes[at];
  if (at === null || !scene) {
    return (
      <Group title="Scene">
        <p className="text-sm text-pretty text-muted">Put the playhead on this Segment to change how its Scene there is framed.</p>
      </Group>
    );
  }
  const portrait = portraitSource(plan);
  const layouts = offeredLayouts(LAYOUTS, portrait);
  const name = (layout: Layout) => (portrait && layout !== "manual" ? "As shot" : NAMES[layout]);
  const own = sceneOverride(edits.layout_overrides, plan, at);
  const source = framingSource(edits, plan, at);
  const apply = (next: LayoutEdits | null, group?: string) => next && onEdits({ ...edits, ...next }, group);
  // The history group of a field of the Framing, by where it is kept: the override's time, or the clip.
  const owner = source?.own ? `layout:${source.own.at}` : "layout:clip";
  const setFraming = (framing: Framing, field: string) => apply(withSceneFraming(edits, plan, at, framing), `${owner}:${field}`);
  // Its own override's Keyframes, and its Transform as it is at the playhead (held at its ends outside it).
  const keyed = source?.own ? manualScene(edits.layout_overrides, plan, at) : null;
  const keyAt = keyed && keyTime(keyed, time);
  const shown = keyed
    ? shownTransform(keyed.framing.transform, keyed.keys, keyAt ?? heldKeyTime(keyed, time), canvasOf(plan))
    : source?.framing.transform;
  const setTransform = (transform: Transform, field: string) => {
    if (!keyed || !source?.own) return setFraming({ ...source!.framing, transform }, `transform.${field}`);
    const written = !!keyed.keys[field as keyof typeof keyed.keys]?.length;
    const done = withSceneTransform(edits, plan, at, transform, time, shown);
    if (done?.notice) notify(done.notice);
    else if (done) apply(done.edits, keyedGroup(`${owner}:transform.${field}`, written, keyAt));
  };
  // Reset (a Crop with a Transform) drops its Transform's Keyframes as well.
  const setCrop = (crop: Crop, field: string, transform?: Transform) => {
    const framing = { ...source!.framing, crop, transform: transform ?? source!.framing.transform };
    const own = source!.own;
    if (!transform || !own?.keys || !PICTURE_KEYS.some((prop) => own.keys?.[prop]?.length)) return setFraming(framing, `crop.${field}`);
    const layout_overrides = edits.layout_overrides.map((override) => (override === own ? { ...own, framing, keys: {} } : override));
    apply({ ...edits, layout_overrides }, `${owner}:crop.${field}`);
  };
  return (
    <Group title={`Scene ${at + 1} at the playhead`}>
      <Select
        label="This Scene's layout"
        value={shownLayout(own?.layout ?? "default", portrait)}
        options={[{ value: "default", label: `The clip's (${name(edits.layout)})` }, ...layouts]}
        onChange={(layout: Layout | "default") => {
          const layout_overrides = sceneLayoutOverrides(edits.layout_overrides, plan, at, layout);
          if (layout_overrides) apply({ ...edits, layout_overrides });
        }}
      />
      <Select label="The clip's layout" value={shownLayout(edits.layout, portrait)} options={layouts} onChange={(layout: Layout) => apply(withClipLayout(edits, plan, at, layout))} />
      {source ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{source.own ? "This Scene" : "All Scenes"}</p>
            <Button size="sm" onClick={() => apply(source.own ? forAllScenes(edits, plan, at) : reframed(edits, plan, at))}>
              {source.own ? "Use for all Scenes" : "Only this Scene"}
            </Button>
          </div>
          <TransformFields
            transform={shown ?? source.framing.transform}
            crop={source.framing.crop}
            size={{ width: plan.source_width, height: plan.source_height }}
            defaults={identity(canvasOf(plan))}
            onChange={setTransform}
            onCrop={setCrop}
            onCropMode={onCropMode}
            keyed={keyed ? { item: sceneRef(at), keys: keyed.keys, inside: keyAt !== null } : undefined}
          />
          <BackgroundFields background={source.framing.background} onChange={(background, field) => setFraming({ ...source.framing, background }, `background.${field}`)} />
        </>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <Button size="sm" onClick={() => apply(reframed(edits, plan, at))}>
            <CropIcon aria-hidden size={16} />
            Reframe by hand
          </Button>
          {portrait ? (
            <Hint more="It stays where you put it for the whole Scene.">A portrait episode is shown as it was shot. Frames this Scene yourself, starting from that.</Hint>
          ) : (
            <Hint more="It stays where you put it for the whole Scene: faces aren't followed there.">
              Frames this Scene yourself, starting from what it shows now.
            </Hint>
          )}
        </div>
      )}
    </Group>
  );
}
