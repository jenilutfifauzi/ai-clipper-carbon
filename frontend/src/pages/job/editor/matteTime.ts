/**
 * Which frame of which Matte piece shows a time of the Source (docs/adr/0015): a copy of the backend's
 * `matte_frame` (backend/app/matte.py); both are tested on the cases in
 * backend/tests/fixtures/matte_frames.json, so that they can't drift (ADR 0001).
 *
 * A Matte is kept in pieces of MATTE_PIECE_SECS on the Source's timeline, one Matte frame per frame of
 * the Source: the Source's frame at `source` seconds is `round(source × fps)`, and a piece's first is
 * its start's, `round(piece × fps)`. A time into a cut-out Segment shows the Source time the per-Segment
 * mapping gives (segmentTime.ts: Speed, Reverse, hold), so its Matte frame follows it.
 */
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
