import { Search } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { VideoEffectKind } from "../../../api";
import { Hint } from "../../../components/InfoTip";
import { cx } from "../../../format";
import { starredOnly, useStarredEffects } from "../../../starredEffects";
import { useVideoEffects, videoLibraryOf } from "../../../videoEffects";
import { useCanvas } from "../editor/canvas";
import { EffectFilters } from "../editor/GradeFilters";
import { fittedSize } from "../editor/picture";
import type { Size } from "../editor/pictureGestures";
import { usePlayback, type Playback } from "../editor/playback";
import { effectsFilter, type Box } from "../editor/videoEffects";
import { isKey, videoEffectOf } from "./actions";
import { DRAG_EFFECT } from "./drag";
import { frameStyle, type LookFrame } from "./LookPanel";
import { NO_STARRED, StarButton, StarredChip } from "./Stars";

/** What an effect goes on, told when a click finds nothing it can go on. */
export const EFFECT_GOES_ON = "An effect goes on Segments, Overlays and Adjustment Layers: select some, or drag it onto the Timeline for an Adjustment Layer";

// The size an Effects card's picture stands for, which its effect's sizes are fractions of: a 16:9
// picture fitted to the Canvas `frame` (1080×608 on 9:16), as an Overlay of the Source at scale 1 is drawn.
function cardBox(frame: Size): Box {
  const { width, height } = fittedSize({ width: 16, height: 9 }, frame);
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * The Effects tab (ADR 0014), as the Filters tab (LookPanel): its cards (`EffectCards`) showing the
 * picture `frameAt` gives at the playhead, to the second. An audition ends with the tab.
 */
export function EffectsPanel({
  frameAt,
  playback,
  ...cards
}: Omit<Parameters<typeof EffectCards>[0], "frame"> & {
  frameAt: (time: number) => LookFrame | null;
  playback: Playback;
}) {
  const second = usePlayback(playback, (time) => Math.round(time));
  // A card's audition ends with the tab, as when the mouse leaves it.
  const audition = useRef(cards.onAudition);
  audition.current = cards.onAudition;
  useEffect(() => () => audition.current(null), []);
  return <EffectCards frame={frameAt(second)} {...cards} />;
}

/**
 * The Effects tab's cards: the Video Effects catalogue by category under sticky headings, searched as
 * it is typed (videoLibraryOf), each card the picture of `frame` with its effect at its defaults,
 * drawn by its imitation (as at time 0: no EffectsClock here). The keys (Cutout) are left out unless
 * `keys` (an Overlay is picked). A mouse over a card auditions it (`onAudition`, null when it leaves),
 * a click adds it to the Pick's stacks (`onPick`), and one but a key drags onto the Timeline for an
 * Adjustment Layer. Each card has a star, and the Starred chip keeps the cards to the starred ones.
 */
export function EffectCards({
  frame,
  keys,
  onPick,
  onAudition,
  kinds: given,
  starred: givenStars,
}: {
  frame: LookFrame | null;
  keys: boolean;
  onPick: (kind: VideoEffectKind) => void;
  onAudition: (kind: VideoEffectKind | null) => void;
  // The catalogue's by default.
  kinds?: VideoEffectKind[] | null;
  // The starred ids, the server's by default.
  starred?: string[] | null;
}) {
  const listed = useVideoEffects();
  const listedStars = useStarredEffects();
  const kinds = given ?? listed;
  const stars = givenStars ?? listedStars;
  const [query, setQuery] = useState("");
  const [starredShown, setStarredShown] = useState(false);
  const box = cardBox(useCanvas());
  if (!kinds) return <Hint>Loading the effects…</Hint>;
  const picture = frameStyle(frame);
  const categories = videoLibraryOf(starredOnly(kinds, stars, starredShown), query, keys);
  return (
    <div className="flex flex-col gap-4">
      <Hint more="Its settings, order and switch are in the Effects section of the inspector.">
        Hover to try an effect on the preview; click to add it to the selection; drag it onto the Timeline for an Adjustment Layer.
      </Hint>
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
      <EffectFilters items={kinds.map((kind) => ({ effects: [videoEffectOf(kind)], box }))} />
      {categories.length === 0 && <p className="text-sm text-muted">{starredShown && !query.trim() ? NO_STARRED : `No effect matches “${query.trim()}”.`}</p>}
      {categories.map(({ category, effects }) => {
        const heading = `effects-${category.toLowerCase()}`;
        return (
          <section key={category} aria-labelledby={heading} className="flex flex-col gap-2">
            <h3 id={heading} className="sticky top-0 z-10 [background:linear-gradient(var(--surface),var(--surface)),var(--bg)] py-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {category}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {effects.map((kind) => (
                <EffectCard key={kind.id} kind={kind} picture={picture} box={box} starred={!!stars?.includes(kind.id)} onPick={() => onPick(kind)} onAudition={onAudition} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// An effect's card: the picture under its effect's imitation at its defaults, its name under it, and
// its star over the picture's corner.
function EffectCard({
  kind,
  picture,
  box,
  starred,
  onPick,
  onAudition,
}: {
  kind: VideoEffectKind;
  picture: CSSProperties;
  // What its picture stands for (cardBox).
  box: Box;
  starred: boolean;
  onPick: () => void;
  onAudition: (kind: VideoEffectKind | null) => void;
}) {
  // A key makes no Adjustment Layer: it is an Overlay's only.
  const droppable = !isKey(kind);
  return (
    <div className="relative">
      <button
        type="button"
        data-effect={kind.id}
        title={kind.description || undefined}
        draggable={droppable}
        onDragStart={(event) => {
          onAudition(null);
          if (!droppable) return event.preventDefault();
          event.dataTransfer.setData(DRAG_EFFECT, kind.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => {
          onAudition(null);
          onPick();
        }}
        // Hover is a mouse's: a touch's pointer leaves as it lifts.
        onPointerEnter={(event) => event.pointerType === "mouse" && onAudition(kind)}
        onPointerLeave={() => onAudition(null)}
        className={cx(
          "raised flex min-h-11 w-full flex-col gap-1.5 rounded-[10px] p-1.5 text-left text-xs font-medium hover:bg-fill",
          "focus-visible:outline-2 focus-visible:outline-focus",
        )}
      >
        <div aria-hidden className="relative isolate aspect-video w-full overflow-hidden rounded-md bg-black">
          <div data-picture className="absolute inset-0" style={{ ...picture, filter: effectsFilter([videoEffectOf(kind)], box) }} />
        </div>
        <span className="truncate px-0.5">{kind.name}</span>
      </button>
      <StarButton id={kind.id} name={kind.name} starred={starred} onPicture className="absolute top-2.5 right-2.5" />
    </div>
  );
}
