import type { Playback } from "../editor/playback";
import type { ItemActions } from "./actions";
import { SHORTCUTS, type ShortcutId } from "./keymap";
import { lastFrame, onFrame, stepFrames } from "./playhead";
import { toggleSkim } from "./skim";
import { counting, locksEditing, recording, type TakeState } from "./takeFlow";
import { nextEditPoint, previousEditPoint } from "./timelineView";

/**
 * What each row of the keymap table (./keymap.ts) does, by its id: run by its key in `useShortcuts`
 * and by the buttons that do the same (the phone's player bar and Playback sheet, the loop and
 * fullscreen buttons), so that a button and its key always agree. False when it can't be done now:
 * its key is then left to the browser.
 */
export type Commands = Record<ShortcutId, () => boolean | void>;

/** The take flow as the commands see it (`more.take`). */
export interface TakeCommands {
  state: () => TakeState;
  press: () => void;
  cancel: () => boolean;
  refused?: () => void;
}

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
    // Delete without items picked: a picked Cue's Words; null when there is nothing of the kind.
    removeCue?: (() => boolean | void) | null;
    // Freeze frame at the playhead; false where none can be made.
    freeze: () => boolean | void;
    // Reverse on or off for the one picked Segment or video Overlay; false where there is none.
    reverse: () => boolean | void;
    // The picked items with sound Muted, or unmuted when all are; false where none is picked.
    mute: () => boolean | void;
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
    // The desktop Workspace's Asset Panel or Inspector hidden or shown (A and P).
    toggleAssets: () => void;
    toggleInspector: () => void;
    // While the Pick is one item that can have Keyframes: a Keyframe added or removed at the
    // playhead on its active row (K), and where its Keyframe before or after `time` is ([ and ]).
    keyframes: { toggle: () => boolean | void; around: (time: number, direction: -1 | 1) => number | null } | null;
    // The take flow (./takeFlow.ts): its state (a Take recording, which Space then stops; one counting
    // down, which Esc cancels; the editing lock), its mic button's press (Shift+R), Esc's cancel, and
    // what tells that a key was refused by the lock; null where the page can't record.
    take?: TakeCommands | null;
  },
): Commands {
  // The picked Text Layers, Shapes, Music Clips and Overlays moved `frames` frames; a run of presses is
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
  // The playhead to the picked item's Keyframe before (-1) or after (1) it, paused; it stays where it
  // is when there is none. Exactly there, not on the frame grid, so that its ‹ ◆ › show it.
  const key = (direction: -1 | 1) => {
    if (!more.keyframes) return false;
    const at = more.keyframes.around(playback.time, direction);
    if (at === null) return;
    if (playback.playing) playback.pause();
    playback.seek(at);
  };
  const take = more.take;
  const commands: Commands = {
    // While a Take records, Space stops it rather than only the picture; while one counts down, the
    // playhead stays still.
    play: () => {
      const state = take?.state();
      if (state && recording(state)) return take!.press();
      if (state && counting(state)) return;
      playback.toggle();
    },
    record: () => (more.take ? more.take.press() : false),
    undo: () => history.undo(),
    redo: () => history.redo(),
    "pick-all": () => more.pickAll(),
    // Esc cancels a Take's countdown, and then picks nothing else.
    "pick-none": () => (take?.cancel() ? undefined : more.pickNone()),
    split: () => more.split(),
    "freeze-frame": () => more.freeze(),
    reverse: () => more.reverse(),
    mute: () => more.mute(),
    copy: () => (actions && !window.getSelection()?.toString() ? actions.copy() : false),
    cut: () => (actions ? actions.cut() : false),
    paste: () => (more.paste ? more.paste() : false),
    duplicate: () => (actions ? actions.duplicate() : false),
    delete: () => (actions ? actions.remove() : more.removeCue ? more.removeCue() : false),
    "ripple-delete": () => (actions ? actions.rippleRemove() : false),
    "step-back": () => step(-1),
    "step-forward": () => step(1),
    "step-back-10": () => step(-10),
    "step-forward-10": () => step(10),
    start: () => playback.seek(0),
    end: () => playback.seek(lastFrame(playback.duration, more.fps)),
    "edit-point-previous": () => jump(previousEditPoint),
    "edit-point-next": () => jump(nextEditPoint),
    "key-previous": () => key(-1),
    "key-next": () => key(1),
    "key-toggle": () => (more.keyframes ? more.keyframes.toggle() : false),
    "move-back": () => move(-1),
    "move-forward": () => move(1),
    "move-back-10": () => move(-10),
    "move-forward-10": () => move(10),
    "zoom-in": () => more.zoom(1),
    "zoom-out": () => more.zoom(-1),
    fit: () => more.fit(),
    fullscreen: () => more.setFullscreen(true),
    "fullscreen-exit": () => {
      take?.cancel();
      more.setFullscreen(false);
    },
    skim: () => toggleSkim(),
    "toggle-assets": () => more.toggleAssets(),
    "toggle-inspector": () => more.toggleInspector(),
    shortcuts: () => more.shortcuts(),
    "mark-in": () => more.markIn(),
    "mark-out": () => more.markOut(),
    loop: () => more.loop(),
    "clear-marks": () => more.clearMarks(),
  };
  return take ? lockedWhileTaking(commands, take) : commands;
}

// The editing shortcuts, and the navigation ones, by their group in the keymap table.
const EDITING = new Set(SHORTCUTS.filter((shortcut) => shortcut.group === "editing").map((shortcut) => shortcut.id));
const NAVIGATION = new Set(SHORTCUTS.filter((shortcut) => shortcut.group === "navigation").map((shortcut) => shortcut.id));

/**
 * `commands` locked while a Take is under way (ADR 0018): from the mic button's press until the Take
 * lands, the editing shortcuts are refused, but Esc still cancels a countdown; while it counts down or
 * records, so are the navigation ones, which would move the playhead the Take is recorded from.
 * Playback (Space stops the Take) and the view's stay. A refused key is still taken, and does nothing
 * (⌘D would be the browser's bookmark, ⌥← its Back), but Esc, which is left to the browser as ever.
 */
function lockedWhileTaking(commands: Commands, take: TakeCommands): Commands {
  const locked = Object.entries(commands).map(([id, run]) => {
    const refused = (state: TakeState) =>
      (EDITING.has(id as ShortcutId) && locksEditing(state) && !(id === "pick-none" && counting(state))) ||
      (NAVIGATION.has(id as ShortcutId) && (counting(state) || recording(state)));
    return [
      id,
      () => {
        if (!refused(take.state())) return run();
        take.refused?.();
        return id === "pick-none" ? false : undefined;
      },
    ];
  });
  return Object.fromEntries(locked) as Commands;
}
