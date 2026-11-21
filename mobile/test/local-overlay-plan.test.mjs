import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalOverlayPlan } from "../src/lib/localOverlayPlan.ts";

test("builds a trimmed, sorted local overlay plan with surrounding text", () => {
  const result = buildLocalOverlayPlan(
    [
      { id: "b", start: "3,5", end: "5", text: " second phrase " },
      { id: "a", start: "0", end: "2", text: "first phrase" },
    ],
    "Hook line",
    "@clipper",
    8,
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.plan, {
    captions: [
      {
        startSeconds: 0,
        endSeconds: 2,
        text: "first phrase",
        words: [
          { text: "first", startSeconds: 0, endSeconds: 1 },
          { text: "phrase", startSeconds: 1, endSeconds: 2 },
        ],
      },
      {
        startSeconds: 3.5,
        endSeconds: 5,
        text: "second phrase",
        words: [
          { text: "second", startSeconds: 3.5, endSeconds: 4.25 },
          { text: "phrase", startSeconds: 4.25, endSeconds: 5 },
        ],
      },
    ],
    hookText: "Hook line",
    watermarkText: "@clipper",
    watermarkOpacity: 0.55,
  });
});

test("rejects malformed times, empty captions, and cues outside the trimmed output", () => {
  const invalidCases = [
    [{ id: "a", start: "x", end: "2", text: "words" }],
    [{ id: "a", start: "0", end: "0", text: "words" }],
    [{ id: "a", start: "0", end: "2", text: "   " }],
    [{ id: "a", start: "1", end: "4", text: "words" }],
  ];

  for (const cues of invalidCases) {
    const result = buildLocalOverlayPlan(cues, "", "", 3);
    assert.equal(result.plan, null);
    assert.ok(result.error);
  }
});

test("normalizes whitespace so Cue text matches the ordered CaptionWord events", () => {
  const result = buildLocalOverlayPlan(
    [{ id: "a", start: "0", end: "2", text: "  halo\n\t dunia   " }],
    "",
    "",
    2,
  );

  assert.equal(result.error, null);
  assert.equal(result.plan.captions[0].text, "halo dunia");
  assert.deepEqual(result.plan.captions[0].words.map((word) => word.text), [
    "halo",
    "dunia",
  ]);
});

test("rejects overlapping caption cues instead of drawing stacked text", () => {
  const result = buildLocalOverlayPlan(
    [
      { id: "a", start: "0", end: "2", text: "first" },
      { id: "b", start: "1.9", end: "3", text: "second" },
    ],
    "",
    "",
    4,
  );
  assert.equal(result.plan, null);
  assert.match(result.error, /bertumpuk/i);
});

test("bounds the manual text lengths and cue count", () => {
  const tooLong = buildLocalOverlayPlan(
    [],
    "h".repeat(121),
    "",
    5,
  );
  assert.equal(tooLong.plan, null);
  assert.match(tooLong.error, /hook/i);

  const tooLongCaption = buildLocalOverlayPlan(
    [{ id: "long", start: "0", end: "1", text: "c".repeat(161) }],
    "",
    "",
    5,
  );
  assert.equal(tooLongCaption.plan, null);
  assert.match(tooLongCaption.error, /caption/i);

  const tooLongWatermark = buildLocalOverlayPlan(
    [],
    "",
    "w".repeat(41),
    5,
  );
  assert.equal(tooLongWatermark.plan, null);
  assert.match(tooLongWatermark.error, /watermark/i);

  const tooMany = buildLocalOverlayPlan(
    Array.from({ length: 51 }, (_, index) => ({
      id: String(index),
      start: String(index * 0.05),
      end: String(index * 0.05 + 0.04),
      text: "word",
    })),
    "",
    "",
    5,
  );
  assert.equal(tooMany.plan, null);
  assert.match(tooMany.error, /50/);
});

test("an empty overlay plan is valid and leaves the basic trim/crop render unchanged", () => {
  const result = buildLocalOverlayPlan([], "", "", 5);
  assert.equal(result.error, null);
  assert.deepEqual(result.plan, {
    captions: [],
    hookText: "",
    watermarkText: "",
    watermarkOpacity: 0.55,
  });
});
