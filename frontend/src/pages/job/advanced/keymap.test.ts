// Seam G (.scratch/navigation-playback/spec.md): the Advanced Edit's shortcuts, as worked examples
// of a key pressed (with its modifiers, Cmd or Ctrl being "command") where the focus is, and the
// shortcut it gives; and the shortcuts sheet drawn from the same table.
import { describe, expect, test } from "vitest";
import { keyNames, matches, resolveShortcut, SHORTCUTS, shortcutSheet, type KeyContext, type Keys } from "./keymap";

describe("resolving a key", () => {
  test("Cmd+Z undoes, Shift+Cmd+Z and Ctrl+Y redo, and Shift+Z zooms to fit", () => {
    expect(resolveShortcut({ key: "z", command: true })).toBe("undo");
    // With Shift, the browser gives the letter in capitals.
    expect(resolveShortcut({ key: "Z", command: true, shift: true })).toBe("redo");
    expect(resolveShortcut({ key: "y", command: true })).toBe("redo");
    expect(resolveShortcut({ key: "Z", shift: true })).toBe("fit");
  });

  test("Space plays, Escape picks nothing, and Shift+Delete is a Ripple delete", () => {
    expect(resolveShortcut({ key: " " })).toBe("play");
    expect(resolveShortcut({ key: "Escape" })).toBe("pick-none");
    expect(resolveShortcut({ key: "Delete", shift: true })).toBe("ripple-delete");
    expect(resolveShortcut({ key: "Backspace" })).toBe("delete");
  });

  test("the rest of today's shortcuts", () => {
    expect(resolveShortcut({ key: "a", command: true })).toBe("pick-all");
    expect(resolveShortcut({ key: "c", command: true })).toBe("copy");
    expect(resolveShortcut({ key: "x", command: true })).toBe("cut");
    expect(resolveShortcut({ key: "v", command: true })).toBe("paste");
    expect(resolveShortcut({ key: "d", command: true })).toBe("duplicate");
    expect(resolveShortcut({ key: "b", command: true })).toBe("split");
    expect(resolveShortcut({ key: "ArrowRight" })).toBe("move-forward");
    expect(resolveShortcut({ key: "ArrowLeft", alt: true })).toBe("move-back-10");
  });

  test("a letter is the same in capitals, as with Caps Lock on", () => {
    expect(resolveShortcut({ key: "Z", command: true })).toBe("undo");
  });

  test("Cmd+L and Cmd+F stay the browser's", () => {
    expect(resolveShortcut({ key: "l", command: true })).toBeNull();
    expect(resolveShortcut({ key: "f", command: true })).toBeNull();
  });

  test("modifiers a shortcut doesn't have give nothing", () => {
    // Shift+→ and Cmd+→ move nothing, and Alt+Cmd+Z undoes nothing.
    expect(resolveShortcut({ key: "ArrowRight", shift: true })).toBeNull();
    expect(resolveShortcut({ key: "ArrowRight", command: true })).toBeNull();
    expect(resolveShortcut({ key: "z", command: true, alt: true })).toBeNull();
  });

  test("? opens the sheet, with Shift or without (as the keyboard's layout needs)", () => {
    expect(resolveShortcut({ key: "?", shift: true })).toBe("shortcuts");
    expect(resolveShortcut({ key: "?" })).toBe("shortcuts");
  });

  test("with a field or stage text focused, nothing but Escape", () => {
    const typing = { typing: true };
    expect(resolveShortcut({ key: "z", command: true }, typing)).toBeNull();
    expect(resolveShortcut({ key: " " }, typing)).toBeNull();
    expect(resolveShortcut({ key: "Backspace" }, typing)).toBeNull();
    expect(resolveShortcut({ key: "?", shift: true }, typing)).toBeNull();
    expect(resolveShortcut({ key: "Escape" }, typing)).toBe("pick-none");
  });

  test("an item with the focus keeps its own arrows, Space and Delete", () => {
    const item = { item: true };
    expect(resolveShortcut({ key: "ArrowLeft" }, item)).toBeNull();
    expect(resolveShortcut({ key: "ArrowRight", alt: true }, item)).toBeNull();
    expect(resolveShortcut({ key: " " }, item)).toBeNull();
    expect(resolveShortcut({ key: "Delete", shift: true }, item)).toBeNull();
    // The rest still go to the table.
    expect(resolveShortcut({ key: "z", command: true }, item)).toBe("undo");
    expect(resolveShortcut({ key: "Escape" }, item)).toBe("pick-none");
  });

  test("F goes full screen; full screen, F and Escape leave it", () => {
    expect(resolveShortcut({ key: "f" })).toBe("fullscreen");
    // With Caps Lock on.
    expect(resolveShortcut({ key: "F" })).toBe("fullscreen");
    const fullscreen = { fullscreen: true };
    expect(resolveShortcut({ key: "f" }, fullscreen)).toBe("fullscreen-exit");
    expect(resolveShortcut({ key: "F" }, fullscreen)).toBe("fullscreen-exit");
    expect(resolveShortcut({ key: "Escape" }, fullscreen)).toBe("fullscreen-exit");
    // Space and the arrows keep working.
    expect(resolveShortcut({ key: " " }, fullscreen)).toBe("play");
    expect(resolveShortcut({ key: "ArrowRight" }, fullscreen)).toBe("move-forward");
  });

  test("Cmd+F stays the browser's, full screen or not", () => {
    expect(resolveShortcut({ key: "f", command: true })).toBeNull();
    expect(resolveShortcut({ key: "f", command: true }, { fullscreen: true })).toBeNull();
  });

  test("on a phone, ? gives nothing: there is no sheet", () => {
    expect(resolveShortcut({ key: "?", shift: true }, { phone: true })).toBeNull();
    expect(resolveShortcut({ key: "z", command: true }, { phone: true })).toBe("undo");
  });

  test("on a phone too, Escape leaves full screen", () => {
    expect(resolveShortcut({ key: "Escape" }, { phone: true, fullscreen: true })).toBe("fullscreen-exit");
  });
});

describe("the table", () => {
  const contexts: KeyContext[] = [
    {},
    { typing: true },
    { item: true },
    { fullscreen: true },
    { fullscreen: true, item: true },
    { phone: true },
    { phone: true, fullscreen: true },
  ];

  test("no two rows share keys in the same context", () => {
    for (const context of contexts) {
      for (const row of SHORTCUTS) {
        for (const keys of row.keys) {
          const shared = SHORTCUTS.filter((other) => matches(other, keys, context)).map((other) => other.id);
          expect(shared.length, `${JSON.stringify(keys)} in ${JSON.stringify(context)}: ${shared.join(", ")}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test("every row gives its own id for each of its keys, on a desktop with nothing focused (full screen for its rows)", () => {
    for (const row of SHORTCUTS) {
      for (const keys of row.keys) expect(resolveShortcut(keys, { fullscreen: row.fullscreen })).toBe(row.id);
    }
  });

  test("ids are unique", () => {
    const ids = SHORTCUTS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the shortcuts sheet", () => {
  test("every row appears once, in its group", () => {
    const sheet = shortcutSheet();
    const listed = sheet.flatMap((group) => group.shortcuts.map((row) => row.id));
    expect([...listed].sort()).toEqual(SHORTCUTS.map((row) => row.id).sort());
    for (const group of sheet) {
      expect(group.shortcuts.length).toBeGreaterThan(0);
      for (const row of group.shortcuts) expect(row.group).toBe(group.group);
    }
  });

  test("groups come as playback, navigation, editing and view", () => {
    const order = ["playback", "navigation", "editing", "view"];
    const groups = shortcutSheet().map((group) => group.group);
    expect(groups).toEqual(order.filter((group) => groups.includes(group as never)));
  });

  const row = (id: string) => SHORTCUTS.find((shortcut) => shortcut.id === id)!;
  const named = (keys: Keys, mac: boolean) => keyNames({ ...row("undo"), keys: [keys] }, mac)[0];

  test("on a Mac, keys are named as a Mac writes them", () => {
    expect(keyNames(row("redo"), true)).toEqual(["⇧⌘Z", "⌘Y"]);
    expect(named({ key: "ArrowRight", shift: true, alt: true }, true)).toBe("⌥⇧→");
    expect(keyNames(row("ripple-delete"), true)).toEqual(["⇧⌫", "⇧⌦"]);
  });

  test("elsewhere, as Ctrl, Alt and Shift", () => {
    expect(keyNames(row("redo"), false)).toEqual(["Ctrl+Shift+Z", "Ctrl+Y"]);
    expect(named({ key: "ArrowRight", shift: true, alt: true }, false)).toBe("Alt+Shift+→");
    expect(keyNames(row("ripple-delete"), false)).toEqual(["Shift+Backspace", "Shift+Delete"]);
  });

  test("Space, Escape and ? by their names", () => {
    expect(keyNames(row("play"), false)).toEqual(["Space"]);
    expect(keyNames(row("pick-none"), true)).toEqual(["Esc"]);
    expect(keyNames(row("shortcuts"), true)).toEqual(["?"]);
    expect(keyNames(row("fullscreen-exit"), false)).toEqual(["F", "Esc"]);
  });
});
