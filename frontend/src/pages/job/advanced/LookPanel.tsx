import { Layers2, LoaderCircle, Palette, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ApiError, jobFilmstripUrl, mediaFilmstripUrl, mediaThumbnailUrl, type ClipSegment, type Grade, type Look, type MediaItem, type Overlay } from "../../../api";
import { Button, buttonClass } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { deleteLook, importLook, shelvesOf, useLooks } from "../../../looks";
import { GradeFilters, GradeVignette } from "../editor/GradeFilters";
import { gradeFilter, gradeOf, NEUTRAL_GRADE } from "../editor/grading";
import { usePlayback, type Playback, type PlayedSegment } from "../editor/playback";
import { playedSourceAt } from "../editor/segmentTime";
import { colorChanges } from "./ColorFields";
import { DRAG_LOOK } from "./drag";
import type { AdvancedEdits } from "./edits";
import { itemsOf, type Pick } from "./pick";
import { CHUNK_SECS } from "./timelineView";

/** What a Look goes on, told when nothing it can go on is picked. */
export const LOOK_GOES_ON = "A Look goes on Segments, Overlays and Adjustment Layers: select some, or nothing for the whole Clip";

/**
 * A picture a Look's card is drawn on: a still (`url`), or one frame of a Filmstrip chunk (`url`,
 * frame `index` of its `count`, laid side by side).
 */
export interface LookFrame {
  url: string;
  strip?: { index: number; count: number };
}

/** The Grade a Look's card is drawn in: the Look at full intensity over neutral dials. */
export const lookGrade = (look: string): Grade => ({ ...NEUTRAL_GRADE, look });

/**
 * The frame the Filters tab's cards show (ADR 0013): the picked Segment's or Overlay's picture (the
 * first picked), at the playhead `time` when it is on it, else at its start; or with neither picked,
 * the Clip's, the Segment under the playhead. Of the Source or a video, it is the Filmstrip's frame
 * nearest that time (one a second); of an image, its still. Null when there is none to show.
 */
export function lookFrame({
  pick,
  segments,
  overlays,
  played,
  time,
  jobId,
  sourceDuration,
  library,
}: {
  pick: Pick;
  segments: ClipSegment[];
  overlays: Overlay[];
  // The Main Track as played, in the order of `segments` (one range, for a Clip without them).
  played: PlayedSegment[];
  time: number;
  jobId: string;
  sourceDuration: number | null;
  library: Map<string, MediaItem>;
}): LookFrame | null {
  const strip = (url: (start: number) => string, at: number, duration: number | null | undefined): LookFrame | null => {
    if (!duration) return null;
    const second = Math.max(0, Math.min(Math.round(at), Math.ceil(duration) - 1));
    const start = Math.floor(second / CHUNK_SECS) * CHUNK_SECS;
    const count = Math.max(1, Math.min(CHUNK_SECS, Math.ceil(Math.round((duration - start) * 1000) / 1000)));
    return { url: url(start), strip: { index: Math.min(second - start, count - 1), count } };
  };
  // A Segment's picture `time` seconds into the Clip (clamped to its span).
  const ofSegment = (index: number, at: number): LookFrame | null => {
    const segment = played[index];
    if (!segment) return null;
    const source = playedSourceAt(segment, Math.min(Math.max(at, segment.start), segment.end));
    const media = segment.media;
    return media ? strip((start) => mediaFilmstripUrl(media, start), source, library.get(media)?.duration) : strip((start) => jobFilmstripUrl(jobId, start), source, sourceDuration);
  };
  for (const item of itemsOf(pick)) {
    if (item.kind === "overlay") {
      const overlay = overlays.find((each) => each.id === item.id);
      const media = overlay && library.get(overlay.media);
      if (!overlay || !media) continue;
      if (media.kind === "image") return { url: mediaThumbnailUrl(media.id) };
      const into = Math.min(Math.max(time - overlay.start, 0), overlay.secs) * (overlay.speed ?? 1);
      return strip((start) => mediaFilmstripUrl(media.id, start), overlay.reverse ? overlay.offset + overlay.secs * (overlay.speed ?? 1) - into : overlay.offset + into, media.duration);
    }
    if (item.kind === "segment") {
      const index = segments.findIndex((segment) => segment.id === item.id);
      if (index !== -1) return ofSegment(index, played[index] && time >= played[index].start && time < played[index].end ? time : (played[index]?.start ?? 0));
    }
  }
  const under = played.findIndex((segment) => time >= segment.start && time < segment.end);
  return ofSegment(under === -1 ? played.length - 1 : under, time);
}

/** A frame as a CSS background: a still covering the card, or one frame of a strip filling it; a drawn sample without one. */
export function frameStyle(frame: LookFrame | null): CSSProperties {
  if (!frame) return SAMPLE;
  if (!frame.strip) return { backgroundImage: `url(${frame.url})`, backgroundSize: "cover", backgroundPosition: "center" };
  const { index, count } = frame.strip;
  return {
    backgroundImage: `url(${frame.url})`,
    backgroundSize: `${count * 100}% 100%`,
    backgroundPosition: `${count > 1 ? (index / (count - 1)) * 100 : 0}% 0`,
  };
}

// The picture without a frame to show: a sky, a figure and warm ground, drawn in CSS.
const SAMPLE: CSSProperties = {
  background:
    "radial-gradient(circle at 50% 42%, #e8c4a8 0 13%, transparent 14%), linear-gradient(180deg, #7fb2e5 0 55%, #c98b4f 55% 100%)",
};

/**
 * The Filters tab (ADR 0013), its cards (`LookCards`) showing the picture `frameAt` gives at the
 * playhead, to the second (as the Filmstrip's frames are). An audition ends with the tab.
 */
export function LookPanel({
  frameAt,
  playback,
  ...cards
}: Omit<Parameters<typeof LookCards>[0], "frame"> & {
  frameAt: (time: number) => LookFrame | null;
  playback: Playback;
}) {
  const second = usePlayback(playback, (time) => Math.round(time));
  // A card's audition ends with the tab, as when the mouse leaves it.
  const audition = useRef(cards.onAudition);
  audition.current = cards.onAudition;
  useEffect(() => () => audition.current(null), []);
  return <LookCards frame={frameAt(second)} {...cards} />;
}

/**
 * The Filters tab's cards: one per Look, by category under a sticky heading, each the picture of
 * `frame` in that Look. A mouse over a card auditions it (`onAudition`, null when it leaves), which
 * draws the preview in it without saving anything; a click gives it to the Pick's Grades, or to the
 * Candidate's with nothing picked (`onPick`). `current` is the Look of the Grade a click goes to.
 * Import Look takes a .cube file as an Imported Look; an Imported card has a delete action, refused
 * with the reason while a clip's Grade names it.
 */
export function LookCards({
  frame,
  current,
  onPick,
  onAudition,
  looks: given,
}: {
  frame: LookFrame | null;
  current: string | null;
  onPick: (look: string) => void;
  onAudition: (look: string | null) => void;
  // The catalogue's by default.
  looks?: Look[] | null;
}) {
  const listed = useLooks();
  const looks = given ?? listed;
  // What the last delete said, by the Look it was of.
  const [refused, setRefused] = useState<{ look: string; message: string } | null>(null);
  if (!looks) return <Hint>Loading the Looks…</Hint>;
  const picture = frameStyle(frame);

  async function remove(look: Look) {
    setRefused(null);
    try {
      await deleteLook(look.id);
    } catch (reason) {
      setRefused({ look: look.id, message: reason instanceof ApiError ? reason.message : `${look.name} couldn't be deleted.` });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Hint more="Its intensity, or taking it away, is in the Color section of the inspector.">
        Hover to try a Look on the preview; click to apply it to the selection, or to the whole Clip with nothing selected; drag it onto the Timeline for an Adjustment Layer.
      </Hint>
      <ImportLook />
      {refused && (
        <p role="alert" className="text-sm text-danger">
          {refused.message}
        </p>
      )}
      <GradeFilters grades={looks.map((look) => lookGrade(look.id))} />
      {shelvesOf(looks).map(({ category, looks: shelf }) => {
        const heading = `looks-${category.replace(/[^a-z0-9]/gi, "-")}`;
        return (
          <section key={category} aria-labelledby={heading} className="flex flex-col gap-2">
            <h3 id={heading} className="sticky top-0 z-10 [background:linear-gradient(var(--surface),var(--surface)),var(--bg)] py-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {category}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {shelf.map((look) => (
                <LookCard
                  key={look.id}
                  look={look}
                  picture={picture}
                  current={current === look.id}
                  onPick={() => onPick(look.id)}
                  onAudition={onAudition}
                  onDelete={look.has_table ? () => void remove(look) : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The phone's Filters sheet: `FiltersPanel` with its cards on the picture `frameAt` gives at the
 * playhead, to the second. The Look "Add as layer" takes is the last card tapped, else the Look of
 * the Grade a tap goes to.
 */
export function PhoneFilters({
  frameAt,
  playback,
  ...panel
}: Omit<Parameters<typeof FiltersPanel>[0], "frame" | "chosen" | "onChoose"> & {
  frameAt: (time: number) => LookFrame | null;
  playback: Playback;
}) {
  const second = usePlayback(playback, (time) => Math.round(time));
  const [chosen, setChosen] = useState<string | null>(null);
  return <FiltersPanel frame={frameAt(second)} chosen={chosen} onChoose={setChosen} {...panel} />;
}

/**
 * The phone's Filters sheet, for the Pick's Grades or the Candidate's with nothing picked: a strip of
 * Look cards by category on `frame` (`LookStrip`), a tap giving the card's Look to them as one step of
 * undo (and making it the `chosen` one, `onChoose`); the intensity of their Look; and "Add as layer",
 * an Adjustment Layer with the chosen Look (else theirs) at the playhead (`onAddLayer`). No audition:
 * a touch has no hover.
 */
export function FiltersPanel({
  edits,
  pick,
  frame,
  chosen,
  looks,
  onChoose,
  onEdits,
  onAddLayer,
}: {
  edits: AdvancedEdits;
  pick: Pick;
  frame: LookFrame | null;
  chosen: string | null;
  // The catalogue's by default.
  looks?: Look[] | null;
  onChoose: (look: string) => void;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onAddLayer: (look: string) => void;
}) {
  const { grades, onLook } = colorChanges({ edits, pick }, onEdits);
  const target = grades.length ? gradeOf(grades[0]) : null;
  const layered = chosen ?? target?.look ?? null;
  return (
    <div className="flex flex-col gap-4">
      {target ? (
        <p className="text-sm text-pretty text-muted">Tap a Look for {pick === null ? "the whole Clip" : "the selection"}.</p>
      ) : (
        <p className="text-sm text-pretty text-muted">{LOOK_GOES_ON}. Or add one as a layer.</p>
      )}
      <LookStrip
        frame={frame}
        current={target?.look ?? null}
        looks={looks}
        onPick={(look) => {
          onChoose(look);
          onLook({ look });
        }}
      />
      <Slider
        label="Intensity"
        value={target?.look ? target.intensity : 100}
        min={0}
        max={100}
        step={1}
        format={(value) => `${Math.round(value)}%`}
        disabled={!target?.look}
        onChange={(intensity) => onLook({ intensity }, "grade:intensity")}
      />
      <Button className="self-start" disabled={layered === null} onClick={() => layered !== null && onAddLayer(layered)}>
        <Layers2 aria-hidden size={16} />
        Add as layer
      </Button>
    </div>
  );
}

/**
 * The phone's strip of Look cards: one row, scrolled sideways within itself, the Looks by category
 * under their names, each card the picture of `frame` in its Look. A tap gives it (`onPick`);
 * `current` is the Look of the Grade a tap goes to.
 */
export function LookStrip({
  frame,
  current,
  onPick,
  looks: given,
}: {
  frame: LookFrame | null;
  current: string | null;
  onPick: (look: string) => void;
  looks?: Look[] | null;
}) {
  const listed = useLooks();
  const looks = given ?? listed;
  if (!looks) return <Hint>Loading the Looks…</Hint>;
  const picture = frameStyle(frame);
  return (
    <div role="group" aria-label="Looks" className="-mx-4 flex min-w-0 snap-x gap-4 overflow-x-auto overscroll-x-contain px-4 pb-1">
      <GradeFilters grades={looks.map((look) => lookGrade(look.id))} />
      {shelvesOf(looks).map(({ category, looks: shelf }) => (
        <section key={category} aria-label={category} className="flex shrink-0 flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{category}</h3>
          <div className="flex gap-2">
            {shelf.map((look) => (
              <div key={look.id} className="flex w-28 shrink-0 snap-start">
                <LookButton look={look} picture={picture} current={current === look.id} onPick={() => onPick(look.id)} onAudition={() => {}} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Import Look: a .cube file (a 3D table, 2 to 65 a side) becomes an Imported Look every Job's Filters
 * tab lists, on the Imported shelf; a file that can't be one is refused naming its bad line.
 */
export function ImportLook() {
  const [importing, setImporting] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);

  async function choose(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    setSaid(null);
    try {
      const look = await importLook(file);
      setSaid({ text: `Added ${look.name} to Imported. Its preview is close; the render draws it exactly.`, problem: false });
    } catch (reason) {
      setSaid({ text: reason instanceof ApiError ? reason.message : "The look couldn't be imported.", problem: true });
    } finally {
      setImporting(false);
      // The same file can be chosen again.
      input.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className={buttonClass(
          "secondary",
          "sm",
          "cursor-pointer self-start has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        )}
      >
        <input type="file" accept=".cube" disabled={importing} onChange={(event) => void choose(event.currentTarget)} className="sr-only" />
        {importing ? <LoaderCircle aria-hidden size={16} className="motion-safe:animate-spin" /> : <Palette aria-hidden size={16} />}
        <span aria-live="polite">{importing ? "Importing…" : "Import Look (.cube)"}</span>
      </label>
      {said && <p className={cx("text-sm", said.problem ? "text-danger" : "text-muted")}>{said.text}</p>}
    </div>
  );
}

/**
 * A Look's card: the picture under the Look's filter and vignette, its name under it; an Imported
 * one's with a delete action (`onDelete`).
 */
function LookCard({
  look,
  picture,
  current,
  onPick,
  onAudition,
  onDelete,
}: {
  look: Look;
  picture: CSSProperties;
  current: boolean;
  onPick: () => void;
  onAudition: (look: string | null) => void;
  onDelete?: () => void;
}) {
  const card = <LookButton look={look} picture={picture} current={current} onPick={onPick} onAudition={onAudition} />;
  if (!onDelete) return card;
  return (
    <div className="group relative flex">
      {card}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${look.name}`}
        title={`Delete ${look.name}`}
        className={cx(
          "absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus [@media(hover:none)]:opacity-100",
        )}
      >
        <Trash2 aria-hidden size={14} />
      </button>
    </div>
  );
}

function LookButton({
  look,
  picture,
  current,
  onPick,
  onAudition,
}: {
  look: Look;
  picture: CSSProperties;
  current: boolean;
  onPick: () => void;
  onAudition: (look: string | null) => void;
}) {
  const grade = lookGrade(look.id);
  return (
    <button
      type="button"
      data-look={look.id}
      // Dropped on the Timeline, it makes an Adjustment Layer with its Look there.
      draggable
      onDragStart={(event) => {
        onAudition(null);
        event.dataTransfer.setData(DRAG_LOOK, look.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => {
        onAudition(null);
        onPick();
      }}
      // Hover is a mouse's: a touch's pointer leaves as it lifts.
      onPointerEnter={(event) => event.pointerType === "mouse" && onAudition(look.id)}
      onPointerLeave={() => onAudition(null)}
      aria-pressed={current}
      className={cx(
        "raised flex min-h-11 w-full flex-col gap-1.5 rounded-[10px] p-1.5 text-left text-xs font-medium hover:bg-fill",
        "focus-visible:outline-2 focus-visible:outline-focus",
        current && "ring-2 ring-accent",
      )}
    >
      <div aria-hidden className="relative isolate aspect-video w-full overflow-hidden rounded-md bg-black">
        <div data-picture className="absolute inset-0" style={{ ...picture, filter: gradeFilter(grade) }} />
        <GradeVignette grade={grade} />
      </div>
      <span className="truncate px-0.5">{look.name}</span>
    </button>
  );
}
