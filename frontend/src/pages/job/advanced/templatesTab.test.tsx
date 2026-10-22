// .scratch/templates/issues/06: the Advanced Edit's Templates tab and sheet, the "Save as Template…"
// dialog and the Inspector's note on a Template item. No jsdom in this repo: the markup is checked with
// renderToStaticMarkup, and the requests with a stubbed fetch.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CapturedTemplate, Shape, TemplateInfo, TextLayer } from "../../../api";
import type { AdvancedEdits } from "./edits";
import { TemplateNote } from "./Inspector";
import { picked } from "./pick";
import { SaveTemplateForm } from "./SaveTemplateDialog";
import { TemplateCards } from "./TemplatesPanel";
import { anchorOverrides, appliedNotice, appliedTo, layerRows, partsLabel, pickedTemplate, saveAsTemplate, templateNote, withApplied } from "./templating";
import { stepped, undone, type Steps } from "./useEditHistory";

const AT = "2026-10-22T00:00:00Z";
const template = (id: string, name: string, changes: Partial<TemplateInfo> = {}): TemplateInfo => ({
  id,
  name,
  created_at: AT,
  updated_at: AT,
  default: false,
  intro: { secs: 3 },
  outro: { secs: 0 },
  ...changes,
});
const BRAND = template("brand", "Podcast — main", { default: true });
const TEASER = template("teaser", "Podcast — teaser", { intro: { secs: 0 } });

const text = (id: string, changes: Partial<TextLayer> = {}) => ({ id, text: id, start: 2, secs: 3, ...changes }) as TextLayer;
const shape = (id: string, changes: Partial<Shape> = {}) => ({ id, start: 0, secs: 20, ...changes }) as Shape;

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [{ id: "s1", start: 100, end: 120 }],
    overlays: [],
    transitions: [],
    adjustment_layers: [],
    ...changes,
  } as AdvancedEdits;
}

// fetch answering each request with `answer` (by its method and path), the requests kept.
function stubFetch(answer: (method: string, path: string, body: unknown) => unknown) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      sent.push({ method, path: url, body });
      return new Response(JSON.stringify(answer(method, url, body)), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("applying a Template from the tab", () => {
  test("puts the dry run's edits in as one undo step, and undo restores the clip's previous items", async () => {
    const handMade = text("mine", { start: 1 });
    const before = edits({ text_layers: [handMade], hook_start: 0.5 });
    const branded = {
      text_layers: [{ ...handMade, start: 4 }, text("name", { start: 5, template: "brand" })],
      shapes: [shape("plate", { secs: 26, template: "brand" })],
      segments: [{ id: "sting", start: 0, end: 3, media: "v".repeat(32), template: "brand" }, { id: "s1", start: 100, end: 120 }],
      hook_start: 3.5,
      hook_secs: 3,
    };
    const sent = stubFetch(() => ({ candidates: [{ candidate_id: "c1", revision: 4, edits: branded, notices: ["1 layer cut short to fit."] }] }));

    const applied = await appliedTo("job1", "c1", "brand");
    // The server is asked for this clip's dry run: nothing is saved by it.
    expect(sent).toEqual([{ method: "POST", path: "/api/jobs/job1/templates/apply", body: { template_id: "brand", candidate_ids: ["c1"], dry_run: true } }]);

    let history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    history = stepped(history, withApplied(before, applied.edits), false);
    expect(history.past).toHaveLength(1);
    expect(history.value.text_layers.map((layer) => [layer.id, layer.start, layer.template ?? null])).toEqual([
      ["mine", 4, null],
      ["name", 5, "brand"],
    ]);
    expect(history.value.segments.map((segment) => segment.id)).toEqual(["sting", "s1"]);
    // What the change didn't set stays as it is.
    expect(history.value.music).toBe(before.music);
    expect(history.value.preset_id).toBe("default");

    const back = undone(history)!;
    expect(back.value).toBe(before);
    expect(back.value.text_layers).toEqual([handMade]);
    expect(back.value.shapes).toEqual([]);

    expect(appliedNotice("Podcast — main", applied.notices)).toBe("Applied “Podcast — main”. 1 layer cut short to fit.");
  });

  test("“No Template” asks for the dry run of none", async () => {
    const sent = stubFetch(() => ({ candidates: [{ candidate_id: "c1", revision: 4, edits: { text_layers: [] }, notices: [] }] }));
    const applied = await appliedTo("job1", "c1", null);
    expect(sent[0].body).toEqual({ template_id: null, candidate_ids: ["c1"], dry_run: true });
    expect(withApplied(edits({ text_layers: [text("name", { template: "brand" })] }), applied.edits).text_layers).toEqual([]);
    expect(appliedNotice(null, [])).toBe("Template items taken off.");
  });
});

// A capture preview: a lower-third two seconds into a 20 s Main Slot, a call to action before its
// end, and a plate under all of it.
const CAPTURED: CapturedTemplate = {
  layers: {
    text_layers: [
      { item: { id: "name", text: "Jeni", start: 2, secs: 3 }, anchor: { start: { boundary: "main_start", offset: 2 }, end: { boundary: "main_start", offset: 5 }, kind: "start" } },
      { item: { id: "cta", text: "Follow", start: 14, secs: 4 }, anchor: { start: { boundary: "main_end", offset: -6 }, end: { boundary: "main_end", offset: -2 }, kind: "end" } },
    ],
    shapes: [{ item: { id: "plate", start: 0, secs: 20 }, anchor: { start: { boundary: "main_start", offset: 0 }, end: { boundary: "main_end", offset: 0 }, kind: "span" } }],
    music: [],
    overlays: [],
    adjustment_layers: [],
  },
  notices: ["1 Music Clip of the episode's sound left out."],
  intro: { secs: 0 },
  outro: { secs: 0 },
};

describe("the save dialog", () => {
  test("shows each layer with its guessed Anchor, and the capture's notices", () => {
    const rows = layerRows(CAPTURED);
    expect(rows.map((row) => [row.label, row.guessed])).toEqual([
      ["Text “Jeni”", "start"],
      ["Text “Follow”", "end"],
      ["Shape", "span"],
    ]);
    const html = renderToStaticMarkup(
      <SaveTemplateForm
        templates={[BRAND]}
        name="Brand"
        over=""
        rows={rows}
        notices={CAPTURED.notices}
        chosen={{ "shapes:plate": "start" }}
        busy={false}
        error={null}
        onName={() => {}}
        onOver={() => {}}
        onAnchor={() => {}}
        onCancel={() => {}}
        onSave={() => {}}
      />,
    );
    const checked = [...html.matchAll(/<li data-layer="([^"]+)">.*?checked="" value="(start|end|span)"/g)].map((match) => [match[1], match[2]]);
    expect(checked).toEqual([
      ["text_layers:name", "start"],
      ["text_layers:cta", "end"],
      ["shapes:plate", "start"],
    ]);
    expect(html).toContain("guessed Span");
    expect(html).toContain("1 Music Clip of the episode&#x27;s sound left out.");
    // Save over offers the owner's Templates.
    expect(html).toContain("Save over");
    expect(html).toMatch(/<option value="brand">Podcast — main<\/option>/);
  });

  test("posts the draft, an override for each Anchor changed from its guess, and the playhead for the poster", async () => {
    const rows = layerRows(CAPTURED);
    const anchors = anchorOverrides(rows, { "shapes:plate": "start", "text_layers:name": "start" });
    expect(anchors).toEqual([{ kind: "shapes", id: "plate", anchor: "start" }]);

    const sent = stubFetch((_, __, body) => ({ ...template("new1", (body as { name: string }).name), notices: [] }));
    const draft = { text_layers: [text("name")] };
    const saved = await saveAsTemplate({ name: " Brand ", jobId: "job1", candidateId: "c1", draft, anchors, at: 4.2 }, null);
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/api/templates",
        body: { name: "Brand", job_id: "job1", candidate_id: "c1", edits: draft, anchors: [{ kind: "shapes", id: "plate", anchor: "start" }], poster_at: 4.2 },
      },
    ]);
    expect(saved.name).toBe("Brand");
  });

  test("“Save over” saves to the chosen Template, which keeps its id", async () => {
    const sent = stubFetch((_, path) => ({ ...template(path.split("/").at(-1)!, "Brand 2"), notices: [] }));
    const saved = await saveAsTemplate({ name: "Brand 2", jobId: "job1", candidateId: "c1", draft: {}, anchors: [], at: 0 }, "brand");
    expect(sent.map(({ method, path }) => [method, path])).toEqual([["PUT", "/api/templates/brand"]]);
    expect(saved.id).toBe("brand");
  });

  test("guesses each Anchor as the backend names it", () => {
    // A title card on the intro, from the Clip's start to the Main Slot's: both edges on the start
    // side, but from two boundaries, so it stretches with the intro: a Span, as the backend says.
    const card = { item: { id: "card", text: "Halo", start: 0.5, secs: 2 }, anchor: { start: { boundary: "clip_start", offset: 0.5 }, end: { boundary: "main_start", offset: -0.5 }, kind: "span" } } as const;
    const rows = layerRows({ ...CAPTURED, layers: { ...CAPTURED.layers, text_layers: [card] } });
    expect(rows.map((row) => [row.id, row.guessed])).toEqual([
      ["card", "span"],
      ["plate", "span"],
    ]);
    // Choosing Start for it is an override.
    expect(anchorOverrides(rows, { "text_layers:card": "start" })).toEqual([{ kind: "text_layers", id: "card", anchor: "start" }]);
  });
});

describe("the Inspector", () => {
  test("shows “From Template” on a Template item, by name, or that it was deleted", () => {
    const state = edits({ text_layers: [text("name", { template: "brand" }), text("mine")], transitions: [{ after: "s1", kind: "fade", secs: 0.5, template: "gone" } as never] });
    expect(pickedTemplate(state, picked({ kind: "text", id: "name" }))).toBe("brand");
    expect(pickedTemplate(state, picked({ kind: "text", id: "mine" }))).toBeNull();
    expect(pickedTemplate(state, { kind: "join", after: "s1" })).toBe("gone");
    expect(pickedTemplate(state, null)).toBeNull();

    expect(renderToStaticMarkup(<TemplateNote templateId="brand" templates={[BRAND, TEASER]} />)).toContain("From Template “Podcast — main”");
    expect(templateNote("gone", [BRAND])).toBe("From a deleted Template");
  });
});

describe("the Templates cards", () => {
  const cards = (phone: boolean) =>
    renderToStaticMarkup(
      <TemplateCards
        templates={[BRAND, TEASER]}
        phone={phone}
        applying={null}
        renaming={null}
        busy={false}
        error={null}
        onApply={() => {}}
        onRename={() => {}}
        onRenamed={() => {}}
        onDelete={() => {}}
        onDefault={() => {}}
      />,
    );

  test("show each poster, name and lengths, a star on the default, and Rename, Make default and Delete on a desktop", () => {
    const html = cards(false);
    expect(html).toContain('src="/api/templates/brand/poster?v=2026-10-22T00%3A00%3A00Z"');
    expect(html).toContain("Podcast — main");
    expect(partsLabel(BRAND)).toBe("Intro 3.0 s · no outro");
    expect(partsLabel(TEASER)).toBe("No intro or outro");
    expect(html.match(/Default for new Jobs/g)).toHaveLength(1);
    expect(html).toContain("No Template");
    for (const action of ["Rename", "Make default", "No default", "Delete"]) expect(html).toContain(`>${action}</button>`);
  });

  test("on the phone's sheet, offer Apply and “No Template” only: no Save, Rename or Delete", () => {
    const html = cards(true);
    expect(html).toContain('aria-label="Apply Podcast — main"');
    expect(html).toContain("No Template");
    for (const action of ["Save", "Rename", "Make default", "Delete", "More for"]) expect(html).not.toContain(action);
  });
});
