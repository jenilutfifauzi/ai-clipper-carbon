// Auto captions in the Text tab, as CapCut's: the Job's captions turned on, or off once on. No jsdom in
// this repo, so the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TextAssets } from "./TextPresets";

const tab = (on: boolean) => renderToStaticMarkup(<TextAssets fonts={null} onAdd={() => {}} autoCaptions={{ on, onChange: async () => {} }} />);

describe("Auto captions", () => {
  test("is offered first in the Text tab while the Job's captions are off", () => {
    const html = tab(false);
    expect(html).toContain('aria-label="Auto captions"');
    expect(html.indexOf("Auto captions")).toBeLessThan(html.indexOf("Add text"));
    expect(html).not.toContain("Turn off");
  });

  test("says it is on, and turns off, once the Job's captions are on", () => {
    const html = tab(true);
    expect(html).toContain("Auto captions on");
    expect(html).toContain("Turn off");
  });

  test("is not shown without the Job", () => {
    expect(renderToStaticMarkup(<TextAssets fonts={null} onAdd={() => {}} />)).not.toContain("Auto captions");
  });
});
