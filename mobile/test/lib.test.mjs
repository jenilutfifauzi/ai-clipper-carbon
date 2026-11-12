import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiRoot } from "../src/lib/apiRoot.ts";
import { isSettled, statusLabel } from "../src/lib/jobStatus.ts";
import { renderErrorMessage } from "../src/lib/renderErrors.ts";
import { isYouTubeUrl } from "../src/lib/youtube.ts";

test("accepts the YouTube links a phone shares", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=abc",
    "https://youtube.com/shorts/abc",
    "https://m.youtube.com/watch?v=abc",
    "https://music.youtube.com/watch?v=abc",
    "https://youtu.be/abc?si=xyz",
    "  HTTPS://YouTu.be/abc  ",
  ]) {
    assert.equal(isYouTubeUrl(url), true, url);
  }
});

test("rejects links that only look like YouTube", () => {
  for (const url of [
    "",
    "youtube.com/watch?v=abc",
    "https://youtube.com/",
    "https://youtube.com.evil.example/watch?v=abc",
    "https://evil.example/youtube.com/watch",
    "https://user@youtube.com/watch?v=abc",
    "ftp://youtube.com/watch?v=abc",
  ]) {
    assert.equal(isYouTubeUrl(url), false, url);
  }
});

test("builds the API root from an HTTPS origin", () => {
  assert.deepEqual(resolveApiRoot(" https://api.example.com/ ", false), {
    root: "https://api.example.com/api",
    error: null,
  });
});

test("refuses to send the session token over plain HTTP outside development", () => {
  assert.equal(resolveApiRoot("http://192.168.1.5:8000", false).root, null);
  assert.equal(
    resolveApiRoot("http://192.168.1.5:8000", true).root,
    "http://192.168.1.5:8000/api",
  );
});

test("refuses a missing origin or one with a path", () => {
  assert.equal(resolveApiRoot(undefined, true).root, null);
  assert.equal(resolveApiRoot("   ", true).root, null);
  assert.equal(resolveApiRoot("https://api.example.com/api", true).root, null);
  assert.equal(resolveApiRoot("api.example.com", true).root, null);
});

test("translates native render error codes", () => {
  const coded = (code, message) => Object.assign(new Error(message), { code });
  assert.equal(
    renderErrorMessage(coded("E_RENDER_CANCELLED", "The video export was cancelled.")),
    "Render dibatalkan.",
  );
  assert.equal(
    renderErrorMessage(coded("E_OVERLAY_PLAN", "Hook terlalu panjang untuk area aman.")),
    "Hook terlalu panjang untuk area aman.",
  );
  assert.equal(
    renderErrorMessage(coded("E_SOMETHING_NEW", "codec said no")),
    "Render gagal di perangkat ini.",
  );
  assert.equal(renderErrorMessage("boom"), "Render gagal di perangkat ini.");
});

test("labels Job statuses and knows which ones stop polling", () => {
  assert.equal(statusLabel("review"), "Siap ditinjau");
  assert.equal(statusLabel("brand_new_status"), "brand_new_status");
  assert.equal(isSettled("review"), true);
  assert.equal(isSettled("error"), true);
  assert.equal(isSettled("rendering"), false);
});
