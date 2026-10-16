// Seam G (.scratch/navigation-playback/spec.md): every shortcut of the Advanced Edit in one table,
// the shortcut a key gives where the focus is, and the shortcuts sheet drawn from the same table.
// A new shortcut is a row here and what it does in `useShortcuts`.

export type ShortcutId =
  | "play"
  | "undo"
  | "redo"
  | "pick-all"
  | "pick-none"
  | "split"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "ripple-delete"
  | "step-back"
  | "step-forward"
  | "step-back-10"
  | "step-forward-10"
  | "start"
  | "end"
  | "move-back"
  | "move-forward"
  | "move-back-10"
  | "move-forward-10"
  | "fit"
  | "shortcuts";

export type ShortcutGroup = "playback" | "navigation" | "editing" | "view";

/**
 * A key as `KeyboardEvent.key` names it (" " for Space), and its modifiers: `command` is Cmd on a
 * Mac and Ctrl elsewhere.
 */
export interface Keys {
  key: string;
  command?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Shortcut {
  id: ShortcutId;
  // Any of these gives it.
  keys: Keys[];
  group: ShortcutGroup;
  // What it does, as the sheet says it.
  label: string;
  // Only on a desktop: a phone has no such thing to show or do.
  desktop?: boolean;
  // Also while a field or stage text has the focus, which takes every other key.
  typing?: boolean;
  // Only full screen (true), or only not (false).
  fullscreen?: boolean;
}

/** Where the focus is when a key is pressed. */
export interface KeyContext {
  // A field, or text being typed on the stage, has it.
  typing?: boolean;
  // An item reached by Tab (or a button) has it, and keeps its own arrows, Enter, Space and Delete.
  item?: boolean;
  fullscreen?: boolean;
  // The phone's layout, without the desktop's shortcuts.
  phone?: boolean;
}

const command = true;
const shift = true;
const alt = true;

export const SHORTCUTS: Shortcut[] = [
  { id: "play", keys: [{ key: " " }], group: "playback", label: "Play or pause" },
  { id: "step-back", keys: [{ key: "ArrowLeft" }], group: "navigation", label: "Playhead one frame back" },
  { id: "step-forward", keys: [{ key: "ArrowRight" }], group: "navigation", label: "Playhead one frame forward" },
  { id: "step-back-10", keys: [{ key: "ArrowLeft", shift }], group: "navigation", label: "Playhead ten frames back" },
  { id: "step-forward-10", keys: [{ key: "ArrowRight", shift }], group: "navigation", label: "Playhead ten frames forward" },
  { id: "start", keys: [{ key: "Home" }], group: "navigation", label: "Playhead to the Clip's start" },
  { id: "end", keys: [{ key: "End" }], group: "navigation", label: "Playhead to the Clip's last frame" },
  { id: "undo", keys: [{ key: "z", command }], group: "editing", label: "Undo" },
  { id: "redo", keys: [{ key: "z", command, shift }, { key: "y", command }], group: "editing", label: "Redo" },
  { id: "pick-all", keys: [{ key: "a", command }], group: "editing", label: "Pick every item" },
  { id: "pick-none", keys: [{ key: "Escape" }], group: "editing", label: "Pick nothing", typing: true },
  {
    id: "split",
    keys: [{ key: "b", command }],
    group: "editing",
    label: "Split at the playhead: the picked items, or with nothing picked, everything there",
  },
  { id: "copy", keys: [{ key: "c", command }], group: "editing", label: "Copy the picked items" },
  { id: "cut", keys: [{ key: "x", command }], group: "editing", label: "Cut the picked items" },
  { id: "paste", keys: [{ key: "v", command }], group: "editing", label: "Paste at the playhead" },
  { id: "duplicate", keys: [{ key: "d", command }], group: "editing", label: "Duplicate the picked items" },
  { id: "delete", keys: [{ key: "Backspace" }, { key: "Delete" }], group: "editing", label: "Delete the picked items" },
  {
    id: "ripple-delete",
    keys: [{ key: "Backspace", shift }, { key: "Delete", shift }],
    group: "editing",
    label: "Ripple delete: delete them and close the gap",
  },
  { id: "move-back", keys: [{ key: "ArrowLeft", alt }], group: "editing", label: "Move the picked Text Layers, Music Clips and Overlays a frame earlier" },
  { id: "move-forward", keys: [{ key: "ArrowRight", alt }], group: "editing", label: "Move them a frame later" },
  { id: "move-back-10", keys: [{ key: "ArrowLeft", alt, shift }], group: "editing", label: "Move them ten frames earlier" },
  { id: "move-forward-10", keys: [{ key: "ArrowRight", alt, shift }], group: "editing", label: "Move them ten frames later" },
  { id: "fit", keys: [{ key: "z", shift }], group: "view", label: "Zoom the Timeline to fit the picked items, or the whole Clip" },
  { id: "shortcuts", keys: [{ key: "?" }], group: "view", label: "Show these shortcuts", desktop: true },
];

// What an item with the focus keeps for itself, with any modifiers.
const ITEM_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "Delete", "Backspace"]);

// A letter is matched in either case, so that Caps Lock doesn't break it. Any other character
// (? = - and Space) is matched whether Shift was held or not: the keyboard's layout says whether it
// needs Shift.
function normal({ key, command = false, shift = false, alt = false }: Keys): Required<Keys> {
  if (key.length !== 1) return { key, command, shift, alt };
  const letter = key.toLowerCase() !== key.toUpperCase();
  return { key: key.toLowerCase(), command, shift: letter && shift, alt };
}

function same(a: Keys, b: Keys): boolean {
  const [x, y] = [normal(a), normal(b)];
  return x.key === y.key && x.command === y.command && x.shift === y.shift && x.alt === y.alt;
}

/** Whether `shortcut` is given by `keys` pressed in `context`. */
export function matches(shortcut: Shortcut, keys: Keys, context: KeyContext = {}): boolean {
  if (context.typing && !shortcut.typing) return false;
  if (context.item && ITEM_KEYS.has(keys.key)) return false;
  if (context.phone && shortcut.desktop) return false;
  if (shortcut.fullscreen !== undefined && shortcut.fullscreen !== Boolean(context.fullscreen)) return false;
  return shortcut.keys.some((own) => same(own, keys));
}

/** The shortcut `keys` give in `context`, or null when they are left to the browser or to what has the focus. */
export function resolveShortcut(keys: Keys, context: KeyContext = {}): ShortcutId | null {
  return SHORTCUTS.find((shortcut) => matches(shortcut, keys, context))?.id ?? null;
}

// The shortcuts sheet.

const GROUPS: { group: ShortcutGroup; label: string }[] = [
  { group: "playback", label: "Playback" },
  { group: "navigation", label: "Navigation" },
  { group: "editing", label: "Editing" },
  { group: "view", label: "View" },
];

/** The sheet's groups in order, each with its shortcuts in the table's order; a group with none is left out. */
export function shortcutSheet(): { group: ShortcutGroup; label: string; shortcuts: Shortcut[] }[] {
  return GROUPS.map(({ group, label }) => ({ group, label, shortcuts: SHORTCUTS.filter((shortcut) => shortcut.group === group) })).filter(
    (group) => group.shortcuts.length > 0,
  );
}

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};
// A Mac's keyboard says "delete" for Backspace, and has a ⌦ for Delete.
const MAC_KEY_NAMES: Record<string, string> = { ...KEY_NAMES, Backspace: "⌫", Delete: "⌦" };

/**
 * How each of `shortcut`'s keys is written: on a Mac (`mac`) as a Mac writes it, its modifiers in
 * the order ⌥ ⇧ ⌘ before the key ("⇧⌘Z"); elsewhere as Ctrl, Alt and Shift ("Ctrl+Shift+Z").
 */
export function keyNames(shortcut: Shortcut, mac: boolean): string[] {
  return shortcut.keys.map(({ key, command, shift, alt }) => {
    const name = (mac ? MAC_KEY_NAMES : KEY_NAMES)[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    if (mac) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${command ? "⌘" : ""}${name}`;
    return [command && "Ctrl", alt && "Alt", shift && "Shift", name].filter(Boolean).join("+");
  });
}
