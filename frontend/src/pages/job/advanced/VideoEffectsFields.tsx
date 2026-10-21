import { Pipette, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AudioEffectSetting, ColourSetting, VideoEffect, VideoEffectKind } from "../../../api";
import { Button, buttonClass } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { useMenu } from "../../../components/Menu";
import { cx } from "../../../format";
import { starredOnly, useStarredEffects } from "../../../starredEffects";
import { useVideoEffects, videoLibraryOf } from "../../../videoEffects";
import { eyedropper, useEyedropper, type EyedropperRequest } from "../editor/eyedropper";
import { Mixed } from "../editor/StyleFields";
import {
  addVideoEffect,
  moveVideoEffect,
  picturedItems,
  removeAllVideoEffects,
  removeVideoEffect,
  setKeyColour,
  setVideoEffectColour,
  setVideoEffectEnabled,
  setVideoEffectSetting,
  sharedVideoStack,
  type Outcome,
} from "./actions";
import { EffectRow, keepEscape, ROW_BUTTON } from "./AudioEffectsFields";
import type { AdvancedEdits } from "./edits";
import type { Pick } from "./pick";
import { NO_STARRED, StarButton, StarredChip } from "./Stars";

/** What the Video Effects section shows and does (VideoEffectsFields' props but the catalogue). */
export interface VideoEffectControls {
  // The picked stack, or "mixed" when the picked pictures' stacks differ.
  stack: VideoEffect[] | "mixed";
  onAdd: (kind: VideoEffectKind) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onEnabled: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  // A setting's slider, each drag one change of its group.
  onSetting: (index: number, setting: AudioEffectSetting, value: number) => void;
  // A colour setting (a key's colour), `#RRGGBB`; a drag of its swatch one change of its group.
  onColour: (index: number, setting: ColourSetting, value: string) => void;
  // The eyedropper's colour for effect `effect`'s colour setting on the Overlays `overlays`, set on
  // the edits as they are when it is picked (setKeyColour).
  onPicked: (overlays: string[], effect: string, setting: ColourSetting, value: string) => void;
  onRemoveAll: () => void;
  // The picked Overlays: whether the library offers keys (Cutout, an Overlay's only), and what the
  // key colour's eyedropper picks from.
  overlays: string[];
}

/**
 * The Video Effects section's controls for the Pick's pictures (actions.ts' picturedItems: its
 * Segments, Overlays and Adjustment Layers), each change one step of undo (a slider's drag one, by its group); null when none is picked.
 */
export function videoEffectChanges(scene: { edits: AdvancedEdits; pick: Pick }, onEdits: (edits: AdvancedEdits, group?: string) => void): VideoEffectControls | null {
  const stack = sharedVideoStack(scene);
  if (stack === null) return null;
  const apply = (outcome: Outcome | null, group?: string) => {
    if (outcome) onEdits(outcome.edits, group);
  };
  const ids = picturedItems(scene)
    .map((item) => `${item.kind}:${item.id}`)
    .join(",");
  return {
    stack,
    onAdd: (kind) => apply(addVideoEffect(scene, kind)),
    onMove: (index, delta) => apply(moveVideoEffect(scene, index, delta)),
    onEnabled: (index, enabled) => apply(setVideoEffectEnabled(scene, index, enabled)),
    onRemove: (index) => apply(removeVideoEffect(scene, index)),
    onSetting: (index, setting, value) => apply(setVideoEffectSetting(scene, index, setting, value), `video-effects:${ids}:${index}:${setting.key}`),
    onColour: (index, setting, value) => apply(setVideoEffectColour(scene, index, setting.key, value), `video-effects:${ids}:${index}:${setting.key}`),
    onPicked: (overlays, effect, setting, value) => {
      const edits = setKeyColour(scene.edits, overlays, effect, setting.key, value);
      if (edits) onEdits(edits);
    },
    onRemoveAll: () => apply(removeAllVideoEffects(scene)),
    overlays: picturedItems(scene).flatMap((item) => (item.kind === "overlay" ? [item.id] : [])),
  };
}

/**
 * The Effects section (ADR 0014), after a picture's Color section: its stack of Video Effects, one row
 * per effect in the order they are drawn (as an Audio Effect's: AudioEffectsFields' EffectRow), Remove
 * all, and Add effect, opening the library. With several pictures picked whose stacks differ, it says
 * Mixed and offers Remove all effects. `kinds` is the catalogue's by default. Desktop only.
 */
export function VideoEffectsFields({ kinds: given, ...controls }: VideoEffectControls & { kinds?: VideoEffectKind[] | null }) {
  const listed = useVideoEffects();
  const kinds = given ?? listed;
  const { stack, onAdd, onRemoveAll, onColour, onPicked, overlays } = controls;
  const headingId = useId();
  const applied = stack === "mixed" ? [] : stack;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="font-semibold">
          Effects
        </h3>
        <AddVideoEffect kinds={kinds} applied={applied} keys={overlays.length > 0} onAdd={onAdd} />
      </div>
      {stack === "mixed" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Mixed />
            The selected items have different effects.
          </p>
          <Button size="sm" variant="ghost" onClick={onRemoveAll}>
            <X aria-hidden size={15} />
            Remove all effects
          </Button>
        </div>
      ) : stack.length === 0 ? (
        <p className="text-sm text-pretty text-muted">No effects. Add one to change how this picture looks.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {stack.map((entry, index) => (
              <EffectRow
                key={`${index}:${entry.id}`}
                entry={entry}
                kind={kinds?.find((kind) => kind.id === entry.id)}
                index={index}
                first={index === 0}
                last={index === stack.length - 1}
                {...controls}
                colourField={(setting, value) => (
                  <KeyColourField
                    setting={setting}
                    value={value}
                    overlays={overlays}
                    onChange={(colour) => onColour(index, setting, colour)}
                    onPicked={(colour) => onPicked(overlays, entry.id, setting, colour)}
                  />
                )}
              />
            ))}
          </ol>
          <Button size="sm" variant="ghost" className="self-start" onClick={onRemoveAll}>
            <X aria-hidden size={15} />
            Remove all
          </Button>
        </>
      )}
    </section>
  );
}

/**
 * A key's colour (Chroma key's): a swatch, its hex code and an eyedropper, which, pressed, waits for
 * a click on the paused preview over one of the picked `overlays` and takes the colour of its graded
 * picture there (EyedropperLayer) to `onPicked`, the latest one given, so the edits made while it
 * waited stay; pressed again, Escape, another Pick or the field gone, it stops waiting.
 */
function KeyColourField({
  setting,
  value,
  overlays,
  onChange,
  onPicked,
}: {
  setting: ColourSetting;
  value: string;
  overlays: string[];
  onChange: (colour: string) => void;
  onPicked: (colour: string) => void;
}) {
  const armed = useEyedropper();
  const picking = armed !== null && armed.overlays.join() === overlays.join();
  const picked = useRef(onPicked);
  useEffect(() => {
    picked.current = onPicked;
  });
  const request = useRef<EyedropperRequest | null>(null);
  const pickedIds = overlays.join();
  useEffect(
    () => () => {
      if (request.current && eyedropper.current === request.current) eyedropper.cancel();
    },
    [pickedIds],
  );
  const arm = () => {
    request.current = { overlays, onPick: (colour) => picked.current(colour) };
    eyedropper.arm(request.current);
  };
  return (
    <ColorField
      label={setting.label}
      value={value}
      onChange={onChange}
      after={
        <Button
          variant="ghost"
          size="xs"
          className={ROW_BUTTON}
          aria-pressed={picking}
          aria-label={picking ? "Stop picking the key colour" : "Pick the key colour from the preview"}
          title="Pick the colour from the preview"
          disabled={!overlays.length}
          onClick={() => (picking ? eyedropper.cancel() : arm())}
        >
          <Pipette aria-hidden size={16} />
        </Button>
      }
    />
  );
}

// Add effect: a popover of the library by category (videoLibraryOf), searched as it is typed; an
// effect already in the stack is greyed out, and the keys (Cutout) are left out unless an Overlay is
// picked (`keys`). A click on another adds it at the bottom of the stack and closes the popover. Each
// has a star, and the Starred chip keeps the library to the starred ones.
function AddVideoEffect({
  kinds,
  applied,
  keys,
  onAdd,
}: {
  kinds: VideoEffectKind[] | null;
  applied: VideoEffect[];
  keys: boolean;
  onAdd: (kind: VideoEffectKind) => void;
}) {
  const { buttonRef, menuRef, open, hide, toggle } = useMenu();
  const [query, setQuery] = useState("");
  const stars = useStarredEffects();
  const [starredShown, setStarredShown] = useState(false);
  const id = useId();
  const categories = kinds ? videoLibraryOf(starredOnly(kinds, stars, starredShown), query, keys) : [];
  return (
    <>
      <button ref={buttonRef} type="button" className={buttonClass("ghost", "sm")} onClick={toggle} aria-expanded={open} aria-controls={id} aria-haspopup="dialog">
        <Plus aria-hidden size={15} />
        Add effect
      </button>
      <div
        ref={menuRef}
        id={id}
        role="dialog"
        aria-label="Add a video effect"
        {...{ popover: "auto" }}
        onKeyDown={keepEscape}
        className="glass fixed inset-auto m-0 max-h-[min(28rem,calc(100vh-1rem))] w-72 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto rounded-[10px] bg-bg/90! p-2 text-text [&:popover-open]:flex"
      >
        <StarredChip on={starredShown} onChange={setStarredShown} />
        <label className="flex min-h-10 items-center gap-2 rounded-[10px] border border-border bg-fill px-2">
          <Search aria-hidden size={15} className="shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search effects"
            aria-label="Search effects"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none"
          />
        </label>
        {kinds === null ? (
          <p className="px-2 py-1 text-sm text-muted">Loading the effects…</p>
        ) : categories.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted">{starredShown && !query.trim() ? NO_STARRED : `No effect matches “${query.trim()}”.`}</p>
        ) : (
          categories.map(({ category, effects }) => (
            <div key={category} role="group" aria-label={category} className="flex flex-col">
              <p className="px-2 pt-1 pb-0.5 text-xs font-semibold text-muted">{category}</p>
              {effects.map((kind) => {
                const added = applied.some((entry) => entry.id === kind.id);
                return (
                  <div key={kind.id} className="flex items-start gap-1">
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => {
                        onAdd(kind);
                        hide();
                      }}
                      className={cx(
                        "flex min-h-9 flex-1 flex-col items-start rounded-md px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-focus",
                        added ? "cursor-default opacity-50" : "hover:bg-fill",
                      )}
                    >
                      <span className="text-sm">
                        {kind.name}
                        {added && <span className="text-muted"> · added</span>}
                      </span>
                      {kind.description && <span className="text-xs text-pretty text-muted">{kind.description}</span>}
                    </button>
                    <StarButton id={kind.id} name={kind.name} starred={!!stars?.includes(kind.id)} />
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </>
  );
}
