/**
 * Which frame of which Matte piece shows a time of the Source, or of a Media Library video (docs/adr/0015): a copy of the backend's
 * `matte_frame` (backend/app/matte.py); both are tested on the cases in
 * backend/tests/fixtures/matte_frames.json, so that they can't drift (ADR 0001).
 *
 * A Matte is kept in pieces of MATTE_PIECE_SECS on the Source's timeline, one Matte frame per frame of
 * the Source: the Source's frame at `source` seconds is `round(source × fps)`, and a piece's first is
 * its start's, `round(piece × fps)`. A time into a cut-out Segment shows the Source time the per-Segment
 * mapping gives (segmentTime.ts: Speed, Reverse, hold), so its Matte frame follows it.
 */
import type { MatteCopy, MattePiece, RetimedRange } from "../../../api";
import { sourceAt, type SegmentRange } from "./segmentTime";

// A piece's length, on the Source's timeline (the backend's PIECE_SECS).
export const MATTE_PIECE_SECS = 10;

/** A frame of a Matte: the piece holding it, by its start in seconds, and which of its frames it is. */
export interface MatteFrame {
  piece: number;
  frame: number;
}

const firstFrame = (piece: number, fps: number) => Math.round(piece * fps);

/** The piece and frame of a Matte that hold the Source's frame at `source` seconds, `fps` frames a second. */
export function matteFrame(source: number, fps: number): MatteFrame {
  const index = Math.floor(source * fps + 0.5);
  let piece = Math.floor(index / fps / MATTE_PIECE_SECS) * MATTE_PIECE_SECS;
  // A piece's first frame is rounded, so a frame near its start may be the piece before's or after's.
  while (piece > 0 && index < firstFrame(piece, fps)) piece -= MATTE_PIECE_SECS;
  while (index >= firstFrame(piece + MATTE_PIECE_SECS, fps)) piece += MATTE_PIECE_SECS;
  return { piece, frame: index - firstFrame(piece, fps) };
}

/** As `matteFrame`, only in one of `pieces` (the plan's, those a cut-out Segment reads): null outside them. */
export function matteAt(source: number, fps: number, pieces: Iterable<number>): MatteFrame | null {
  const found = matteFrame(source, fps);
  for (const piece of pieces) if (piece === found.piece) return found;
  return null;
}

/** The Matte frame `segment` shows `offset` seconds into it on the Timeline (at its Speed, in Reverse, or held). */
export const segmentMatte = (segment: SegmentRange, offset: number, fps: number): MatteFrame => matteFrame(sourceAt(segment, offset), fps);

/** Where a piece's video is sought to show its `frame`: the middle of the frame, so that rounding never shows the one before. */
export const matteSeek = (frame: number, fps: number) => (frame + 0.5) / fps;

/**
 * How a Matte follows a picture's video (its master): `at` gives the time on the Matte its media time
 * shows (the Source's, read in the pieces; or with `copy`, seconds into a reversed Matte copy, read
 * from its start), and `rate` how many times faster than its master the Matte plays.
 */
export interface MatteClock {
  at: (time: number) => number;
  rate: number;
  copy: string | null;
}

/** A deck's: its master plays the Source itself. */
export const SOURCE_CLOCK: MatteClock = { at: (time) => time, rate: 1, copy: null };

/**
 * The clock of a cut-out Segment that plays `segment` (its range on the Source) from its preview copy
 * of `range` (retimedCopy.ts's `segmentCopy`), its master `at` seconds into the copy at its start;
 * `matte`, the reversed Matte copy its plan lists. A copy retimed at a Speed holds `speed` seconds of
 * the Source a second. Forwards (a Speed a browser won't play), the Source time is mapped and read in
 * the pieces; in Reverse, the Matte's reversed copy is read alike (null until it is listed). Until
 * its copy is made (`at` null) its master holds the Source's own frame: the deck's clock.
 */
export function copyClock(segment: SegmentRange, range: RetimedRange, at: number | null, matte: MatteCopy | null): MatteClock | null {
  if (at == null) return SOURCE_CLOCK;
  const speed = range.speed ?? 1;
  if (!segment.reverse) return { at: (time) => segment.start + (time - at) * speed, rate: speed, copy: null };
  if (!matte) return null;
  return { at: (time) => matte.at + (time - at) * speed, rate: speed, copy: matte.url };
}

/** The reversed Matte copy `copies` (the plan's) lists for a picture playing `segment` of `media` (null: the Source) backwards. */
export const matteCopyOf = (copies: MatteCopy[] | undefined, segment: SegmentRange, media: string | null = null): MatteCopy | null =>
  copies?.find(
    (copy) => (copy.media ?? null) === media && Math.abs(copy.start - segment.start) < 1e-6 && Math.abs(copy.end - segment.end) < 1e-6,
  ) ?? null;

/** The pieces of one item's Matte among the plan's (`pieces`): the Source's (`media` null), or a Media Library item's. */
export const itemPieces = (pieces: MattePiece[] | undefined, media: string | null = null): MattePiece[] =>
  (pieces ?? []).filter((piece) => (piece.media ?? null) === media);

/** The frame of a reversed Matte copy shown `time` seconds into it, as `matteFrame` finds a piece's (its one piece starting at 0). */
export const copyFrame = (time: number, fps: number): MatteFrame | null => (time < 0 ? null : { piece: 0, frame: Math.floor(time * fps + 0.5) });
