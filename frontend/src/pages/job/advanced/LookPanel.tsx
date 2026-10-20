import { useEffect, useRef, type CSSProperties } from "react";
import { jobFilmstripUrl, mediaFilmstripUrl, mediaThumbnailUrl, type ClipSegment, type Grade, type Look, type MediaItem, type Overlay } from "../../../api";
import { Hint } from "../../../components/InfoTip";
import { cx } from "../../../format";
import { shelvesOf, useLooks } from "../../../looks";
import { GradeFilters, GradeVignette } from "../editor/GradeFilters";
import { gradeFilter, NEUTRAL_GRADE } from "../editor/grading";
import { usePlayback, type Playback, type PlayedSegment } from "../editor/playback";
import { playedSourceAt } from "../editor/segmentTime";
import { itemsOf, type Pick } from "./pick";
import { CHUNK_SECS } from "./timelineView";

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

// A frame as a CSS background: a still covering the card, or one frame of a strip filling it.
function frameStyle(frame: LookFrame | null): CSSProperties {
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
  if (!looks) return <Hint>Loading the looks…</Hint>;
  const picture = frameStyle(frame);
  return (
    <div className="flex flex-col gap-4">
      <Hint more="Its intensity, or taking it away, is in the Color section of the inspector.">
        Hover to try a look on the preview; click to apply it to the selection, or to the whole clip with nothing selected.
      </Hint>
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
                <LookCard key={look.id} look={look} picture={picture} current={current === look.id} onPick={() => onPick(look.id)} onAudition={onAudition} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A Look's card: the picture under the Look's filter and vignette, its name under it. */
function LookCard({
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
      onClick={() => {
        onAudition(null);
        onPick();
      }}
      // Hover is a mouse's: a touch's pointer leaves as it lifts.
      onPointerEnter={(event) => event.pointerType === "mouse" && onAudition(look.id)}
      onPointerLeave={() => onAudition(null)}
      aria-pressed={current}
      className={cx(
        "raised flex flex-col gap-1.5 rounded-[10px] p-1.5 text-left text-xs font-medium hover:bg-fill",
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
