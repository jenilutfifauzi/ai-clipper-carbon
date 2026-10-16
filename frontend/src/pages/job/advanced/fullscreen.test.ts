// How the Advanced Edit's preview goes full screen, by what the browser allows a page.
import { describe, expect, test } from "vitest";
import { fullscreenWay } from "./fullscreen";

describe("going full screen", () => {
  test("by the Fullscreen API where a page may put an element full screen", () => {
    expect(fullscreenWay({ fullscreenEnabled: true })).toBe("element");
  });

  test("by Safari's prefixed one before it had the API's own names", () => {
    expect(fullscreenWay({ webkitFullscreenEnabled: true })).toBe("element");
  });

  test("over the whole window on an iPhone, where only a video can go full screen", () => {
    expect(fullscreenWay({})).toBe("window");
    expect(fullscreenWay({ fullscreenEnabled: false })).toBe("window");
  });
});
