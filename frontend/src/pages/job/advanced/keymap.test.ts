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
  });

  test("→ steps the playhead a frame, Shift+→ ten; Alt+→ moves the Pick a frame, Alt+Shift+→ ten", () => {
    expect(resolveShortcut({ key: "ArrowRight" })).toBe("step-forward");
    expect(resolveShortcut({ key: "ArrowRight", shift: true })).toBe("step-forward-10");
    expect(resolveShortcut({ key: "ArrowRight", alt: true })).toBe("move-forward");
    expect(resolveShortcut({ key: "ArrowRight", alt: true, shift: true })).toBe("move-forward-10");
    expect(resolveShortcut({ key: "ArrowLeft" })).toBe("step-back");
    expect(resolveShortcut({ key: "ArrowLeft", shift: true })).toBe("step-back-10");
    expect(resolveShortcut({ key: "ArrowLeft", alt: true })).toBe("move-back");
    expect(resolveShortcut({ key: "ArrowLeft", alt: true, shift: true })).toBe("move-back-10");
  });

  test("Home goes to the Clip's start, End to its last frame", () => {
    expect(resolveShortcut({ key: "Home" })).toBe("start");
    expect(resolveShortcut({ key: "End" })).toBe("end");
  });

  test("↑ goes to the previous Edit Point and ↓ to the next", () => {
    expect(resolveShortcut({ key: "ArrowUp" })).toBe("edit-point-previous");
    expect(resolveShortcut({ key: "ArrowDown" })).toBe("edit-point-next");
    // With modifiers they are the browser's.
    expect(resolveShortcut({ key: "ArrowDown", shift: true })).toBeNull();
    expect(resolveShortcut({ key: "ArrowUp", command: true })).toBeNull();
  });

  test("a letter is the same in capitals, as with Caps Lock on", () => {
    expect(resolveShortcut({ key: "Z", command: true })).toBe("undo");
  });

  test("Cmd+L and Cmd+F stay the browser's", () => {
    expect(resolveShortcut({ key: "l", command: true })).toBeNull();
    expect(resolveShortcut({ key: "f", command: true })).toBeNull();
  });

  test("modifiers a shortcut doesn't have give nothing", () => {
    // Cmd+→ and Cmd+Home are the browser's, and Alt+Cmd+Z undoes nothing.
    expect(resolveShortcut({ key: "ArrowRight", command: true })).toBeNull();
    expect(resolveShortcut({ key: "Home", command: true })).toBeNull();
    expect(resolveShortcut({ key: "z", command: true, alt: true })).toBeNull();
  });

  test("= zooms the Timeline in and - zooms it out, and with Cmd or Ctrl they stay the browser's page zoom", () => {
    expect(resolveShortcut({ key: "=" })).toBe("zoom-in");
    // + is = with Shift on many keyboards, and a key of its own on others.
    expect(resolveShortcut({ key: "+", shift: true })).toBe("zoom-in");
    expect(resolveShortcut({ key: "+" })).toBe("zoom-in");
    expect(resolveShortcut({ key: "-" })).toBe("zoom-out");
    expect(resolveShortcut({ key: "=", command: true })).toBeNull();
    expect(resolveShortcut({ key: "+", command: true, shift: true })).toBeNull();
    expect(resolveShortcut({ key: "-", command: true })).toBeNull();
    // Shift+Z still zooms to fit.
    expect(resolveShortcut({ key: "Z", shift: true })).toBe("fit");
  });

  test("? opens the sheet, with Shift or without (as the keyboard's layout needs)", () => {
    expect(resolveShortcut({ key: "?", shift: true })).toBe("shortcuts");
    expect(resolveShortcut({ key: "?" })).toBe("shortcuts");
  });

  test("with a field or stage text focused, nothing but Escape", () => {
    const typing = { typing: true };
    expect(resolveShortcut({ key: "z", command: true }, typing)).toBeNull();
    expect(resolveShortcut({ key: "ArrowRight" }, typing)).toBeNull();
    expect(resolveShortcut({ key: "Home" }, typing)).toBeNull();
    expect(resolveShortcut({ key: " " }, typing)).toBeNull();
    expect(resolveShortcut({ key: "Backspace" }, typing)).toBeNull();
    expect(resolveShortcut({ key: "?", shift: true }, typing)).toBeNull();
    expect(resolveShortcut({ key: "Escape" }, typing)).toBe("pick-none");
  });

  test("an item with the focus keeps its own arrows, Space and Delete", () => {
    const item = { item: true };
    expect(resolveShortcut({ key: "ArrowLeft" }, item)).toBeNull();
    expect(resolveShortcut({ key: "ArrowRight" }, item)).toBeNull();
    expect(resolveShortcut({ key: "ArrowRight", shift: true }, item)).toBeNull();
    expect(resolveShortcut({ key: "ArrowRight", alt: true }, item)).toBeNull();
    // A Text Layer or the Watermark on the stage moves up and down by its arrows.
    expect(resolveShortcut({ key: "ArrowUp" }, item)).toBeNull();
    expect(resolveShortcut({ key: "ArrowDown" }, item)).toBeNull();
    expect(resolveShortcut({ key: " " }, item)).toBeNull();
    expect(resolveShortcut({ key: "Delete", shift: true }, item)).toBeNull();
    // The rest still go to the table.
    expect(resolveShortcut({ key: "z", command: true }, item)).toBe("undo");
    expect(resolveShortcut({ key: "Escape" }, item)).toBe("pick-none");
    expect(resolveShortcut({ key: "End" }, item)).toBe("end");
  });

  test("on a phone, ? gives nothing: there is no sheet", () => {
    expect(resolveShortcut({ key: "?", shift: true }, { phone: true })).toBeNull();
    expect(resolveShortcut({ key: "z", command: true }, { phone: true })).toBe("undo");
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

  test("every row gives its own id for each of its keys, on a desktop with nothing focused", () => {
    for (const row of SHORTCUTS) {
      for (const keys of row.keys) expect(resolveShortcut(keys)).toBe(row.id);
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
    expect(keyNames(row("start"), true)).toEqual(["Home"]);
  });

  test("Alt+Shift+→ moves the Pick ten frames: ⌥⇧→ on a Mac, Alt+Shift+→ elsewhere", () => {
    expect(keyNames(row("move-forward-10"), true)).toEqual(["⌥⇧→"]);
    expect(keyNames(row("move-forward-10"), false)).toEqual(["Alt+Shift+→"]);
    expect(keyNames(row("step-back-10"), true)).toEqual(["⇧←"]);
  });

  test("frame steps, Home/End and the Edit Points are listed under navigation", () => {
    const navigation = shortcutSheet().find((group) => group.group === "navigation")!;
    expect(navigation.shortcuts.map((shortcut) => shortcut.id)).toEqual([
      "step-back",
      "step-forward",
      "step-back-10",
      "step-forward-10",
      "start",
      "end",
      "edit-point-previous",
      "edit-point-next",
    ]);
    expect(keyNames(row("edit-point-previous"), true)).toEqual(["↑"]);
    expect(keyNames(row("edit-point-next"), false)).toEqual(["↓"]);
  });
});
