import { useCallback, useEffect, useRef, useState } from "react";

// Changes are saved once they pause for this long, and at once when the workspace closes.
const SAVE_AFTER_MS = 700;
// Changes of one group (a slider, typing, arrow keys) this close together are one step of the history.
const GROUP_MS = 1500;
// A group with this prefix names one gesture (a drag, unique per gesture): its changes are one step
// however long it is held.
const GESTURE = "drag:";
// The most steps kept to undo.
const MAX_STEPS = 100;

export interface EditHistory<T> {
  value: T;
  // `group` names a gesture or a field: its changes, while they keep coming, are undone as one (`merges`).
  set: (value: T, group?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Saves what is waiting now; resolves once the save is answered.
  flush: () => Promise<void>;
  // Whether changes wait to be saved.
  waiting: () => boolean;
  // Takes a newer Revision saved elsewhere (ADR 0003): the edits become `value` (it, or it merged
  // with the changes here), and `rebase` is applied to every step of the history, so that undo takes
  // back only this editor's own. With `save`, `value` is saved once changes pause.
  elsewhere: (value: T, rebase: (step: T) => T, save: boolean) => void;
  // Takes a Revision saved outside (the Agent's, for a turn this tab started, ADR 0028) as a new undo
  // step of `group`, so that undo takes it back like an edit here. It isn't saved again: the Revision
  // exists, and the next save here carries it. With `save` (it was merged with changes waiting here),
  // `value` is saved once changes pause.
  adopt: (value: T, group: string, save?: boolean) => void;
}

/**
 * Whether a change of `group` at `at` (ms) joins the last step, made by `last` (null after an undo, a
 * redo or a change without a group). No group never merges; a gesture's group, for as long as it keeps
 * coming; any other group, within GROUP_MS of its last change.
 */
export function merges(last: { group: string; at: number } | null, group: string | undefined, at: number): boolean {
  if (group === undefined || last?.group !== group) return false;
  return group.startsWith(GESTURE) || at - last.at < GROUP_MS;
}

/** An undo history: the steps to undo, the value now, and the steps to redo. */
export interface Steps<T> {
  past: T[];
  value: T;
  future: T[];
}

/** `old` with `value` made: a new step, or (`merge`) the last step changed; nothing left to redo. */
export function stepped<T>(old: Steps<T>, value: T, merge: boolean): Steps<T> {
  return { past: merge ? old.past : [...old.past, old.value].slice(-MAX_STEPS), value, future: [] };
}

/** `old` with `value`, taken from outside, as a step of its own: undone like any other, and nothing left to redo. */
export function adopted<T>(old: Steps<T>, value: T): Steps<T> {
  return stepped(old, value, false);
}

/** `old` with its last step undone; null when there is none. */
export function undone<T>(old: Steps<T>): Steps<T> | null {
  if (!old.past.length) return null;
  return { past: old.past.slice(0, -1), value: old.past[old.past.length - 1], future: [old.value, ...old.future] };
}

/** `old` with the step last undone made again; null when there is none. */
export function redone<T>(old: Steps<T>): Steps<T> | null {
  if (!old.future.length) return null;
  const [value, ...future] = old.future;
  return { past: [...old.past, old.value], value, future };
}

/**
 * The Advanced Edit's edits of a Candidate, with undo and redo. `saved` is the Candidate's as loaded:
 * it starts the history, and later answers of the backend don't replace what is being edited. Every
 * change (and every undo or redo) is saved with `save` once changes pause.
 */
export function useEditHistory<T>(saved: T, save: (value: T) => Promise<unknown>): EditHistory<T> {
  const [state, setState] = useState<Steps<T>>({ past: [], value: saved, future: [] });
  const last = useRef<{ group: string; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ value: T } | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) {
      const { value } = pending.current;
      pending.current = null;
      saving.current = saveRef.current(value).catch(() => {});
    }
    return saving.current.then(() => {});
  }, []);
  // Closing the workspace saves what is waiting.
  useEffect(() => () => void flush(), [flush]);

  function persist(value: T) {
    pending.current = { value };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }

  function set(value: T, group?: string) {
    const now = performance.now();
    const merge = merges(last.current, group, now);
    last.current = group === undefined ? null : { group, at: now };
    setState((old) => stepped(old, value, merge));
    persist(value);
  }

  function undo() {
    const next = undone(state);
    if (!next) return;
    last.current = null;
    setState(next);
    persist(next.value);
  }

  function redo() {
    const next = redone(state);
    if (!next) return;
    last.current = null;
    setState(next);
    persist(next.value);
  }

  function elsewhere(value: T, rebase: (step: T) => T, save: boolean) {
    last.current = null;
    setState((old) => ({ past: old.past.map(rebase), value, future: old.future.map(rebase) }));
    if (save) persist(value);
  }

  function adopt(value: T, group: string, save = false) {
    last.current = { group, at: performance.now() };
    setState((old) => adopted(old, value));
    if (save) persist(value);
  }

  return {
    value: state.value,
    set,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    flush,
    waiting: () => pending.current !== null,
    elsewhere,
    adopt,
  };
}

/**
 * `history` as the editor's hands reach it, locked while `refuse()` says so (a Take under way, ADR
 * 0018): every hand edit (the Timeline's, the inspector's, the stage's and the shortcuts', which all
 * go through `set`), undo and redo do nothing then, and `refuse` tells why. A change from elsewhere
 * (`elsewhere`, edit-sync) still applies, and saving goes on as ever.
 */
export function lockedWhile<T>(history: EditHistory<T>, refuse: () => boolean): EditHistory<T> {
  return {
    ...history,
    set: (value, group) => {
      if (!refuse()) history.set(value, group);
    },
    undo: () => {
      if (!refuse()) history.undo();
    },
    redo: () => {
      if (!refuse()) history.redo();
    },
  };
}
