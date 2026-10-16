import type { Playback } from "../editor/playback";
import type { ItemActions } from "./actions";
import type { ShortcutId } from "./keymap";
import { lastFrame, onFrame, stepFrames } from "./playhead";
import { toggleSkim } from "./skim";
import { nextEditPoint, previousEditPoint } from "./timelineView";

/**
 * What each row of the keymap table (./keymap.ts) does, by its id: run by its key in `useShortcuts`
 * and by the buttons that do the same (the phone's player bar and Playback sheet, the loop and
 * fullscreen buttons), so that a button and its key always agree. False when it can't be done now:
 * its key is then left to the browser.
 */
export type Commands = Record<ShortcutId, () => boolean | void>;

/**
 * The Advanced Edit's commands: those for the picked items only while something is picked, and copy
 * only while no text on the page is selected.
 */
export function commandsOf(
  history: { undo: () => void; redo: () => void },
  playback: Playback,
  actions: ItemActions | null,
  more: {
    pickAll: () => void;
    pickNone: () => void;
    paste: (() => void) | null;
    move: ((delta: number, group: string) => void) | null;
    // Split at the playhead: the picked items, or with nothing picked, everything there.
    split: () => void;
    // Zoom the Timeline to fit: what is picked, or with nothing picked, the whole Clip.
    fit: () => void;
    // Zoom the Timeline in (1) or out (-1) about the playhead.
    zoom: (direction: 1 | -1) => void;
    // Open the shortcuts sheet.
    shortcuts: () => void;
    // Where the previous and next Edit Point jumps take the playhead, sorted.
    editPoints: number[];
    // Mark In or Out at the playhead; Loop on or off; the marks cleared and Loop off.
    markIn: () => void;
    markOut: () => void;
    loop: () => void;
    clearMarks: () => void;
    // The Clip's frame rate: a frame step's, and an arrow move's.
    fps: number;
    // The preview put full screen, or back.
    setFullscreen: (on: boolean) => void;
  },
): Commands {
  // The picked Text Layers, Music Clips and Overlays moved `frames` frames; a run of presses is
  // undone as one. With nothing to move the key is still taken: Alt+← and → are the browser's Back
  // and Forward, which would leave the edit.
  const move = (frames: number) => more.move?.(frames / more.fps, "key:move");
  // The playhead `frames` frames on, on the frame grid, paused to show the frame stepped to.
  const step = (frames: number) => {
    if (playback.playing) playback.pause();
    playback.seek(stepFrames(playback.time, frames, { fps: more.fps, duration: playback.duration }));
  };
  // The playhead to the Edit Point `to` gives from it, paused, on the frame grid; none past either end.
  const jump = (to: (points: number[], time: number, fps: number) => number | null) => {
    const point = to(more.editPoints, playback.time, more.fps);
    if (point === null) return;
    if (playback.playing) playback.pause();
    playback.seek(Math.min(onFrame(point, more.fps), lastFrame(playback.duration, more.fps)));
  };
  return {
    play: () => playback.toggle(),
    undo: () => history.undo(),
    redo: () => history.redo(),
    "pick-all": () => more.pickAll(),
    "pick-none": () => more.pickNone(),
    split: () => more.split(),
    copy: () => (actions && !window.getSelection()?.toString() ? actions.copy() : false),
    cut: () => (actions ? actions.cut() : false),
    paste: () => (more.paste ? more.paste() : false),
    duplicate: () => (actions ? actions.duplicate() : false),
    delete: () => (actions ? actions.remove() : false),
    "ripple-delete": () => (actions ? actions.rippleRemove() : false),
    "step-back": () => step(-1),
    "step-forward": () => step(1),
    "step-back-10": () => step(-10),
    "step-forward-10": () => step(10),
    start: () => playback.seek(0),
    end: () => playback.seek(lastFrame(playback.duration, more.fps)),
    "edit-point-previous": () => jump(previousEditPoint),
    "edit-point-next": () => jump(nextEditPoint),
    "move-back": () => move(-1),
    "move-forward": () => move(1),
    "move-back-10": () => move(-10),
    "move-forward-10": () => move(10),
    "zoom-in": () => more.zoom(1),
    "zoom-out": () => more.zoom(-1),
    fit: () => more.fit(),
    fullscreen: () => more.setFullscreen(true),
    "fullscreen-exit": () => more.setFullscreen(false),
    skim: () => toggleSkim(),
    shortcuts: () => more.shortcuts(),
    "mark-in": () => more.markIn(),
    "mark-out": () => more.markOut(),
    loop: () => more.loop(),
    "clear-marks": () => more.clearMarks(),
  };
}
