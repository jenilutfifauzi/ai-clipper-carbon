// .scratch/background-removal/issues/01-person-model-download-and-remove.md: the Inspector's "Remove
// background" section on a Segment or an Overlay, showing the person model's state (ADR 0015): Download
// with its size and licence, its progress with Cancel, Ready with Remove, and Failed with its message and
// Retry; polled while it downloads. The same section is in the phone's sheet, which shows the Inspector.
// No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ApiError, type PersonModelInfo } from "../../../api";
import { PERSON_MODEL_POLL_MS, PersonModelSource, type PersonModelAction } from "./personModel";
import { RemoveBackgroundFields } from "./RemoveBackgroundFields";

const TOTAL = 14_975_696;
const model = (state: PersonModelInfo["state"], more: Partial<PersonModelInfo> = {}): PersonModelInfo => ({
  state,
  done: 0,
  total: TOTAL,
  message: null,
  name: "Person model",
  licence: "GPL-3.0",
  ...more,
});
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}</button>`))?.[0];
const fields = (info: PersonModelInfo | null, message: string | null = null) =>
  renderToStaticMarkup(<RemoveBackgroundFields model={info} message={message} onAction={() => {}} />);

describe("the Remove background section", () => {
  test("offers the person model's download with its size and licence while it isn't here", () => {
    const html = fields(model("absent"));
    expect(html).toContain("Remove background");
    expect(button(html, "Download person model \\(15 MB, GPL-3.0\\)")).not.toContain('disabled=""');
    expect(html).not.toContain("Remove person model");
  });

  test("shows its progress in megabytes with Cancel while it downloads", () => {
    const html = fields(model("downloading", { done: 6_000_000 }));
    expect(html).toContain("Downloading the person model…");
    expect(html).toContain("6 of 15 MB");
    expect(html).toMatch(/role="progressbar" aria-label="Downloading the person model"[^>]*aria-valuenow="40(\.\d+)?"/);
    expect(button(html, "Cancel the download")).toBeDefined();
    expect(html).not.toContain("Download person model");
  });

  test("once here, says it is ready and offers Remove", () => {
    const html = fields(model("ready", { done: TOTAL }));
    expect(html).toContain("Person model is on this Mac");
    expect(button(html, "Remove person model \\(15 MB\\)")).toBeDefined();
    expect(html).not.toContain("Download person model");
  });

  test("tells a failed download's message, with Retry", () => {
    const message = "The person model's download didn't match its checksum, so it was deleted: Download it again";
    const html = fields(model("failed", { message }));
    expect(html).toContain("The person model&#x27;s download didn&#x27;t match its checksum");
    expect(button(html, "Retry the download")).toBeDefined();
    // A refused action tells why, too.
    expect(fields(model("ready"), "Couldn't remove the person model: busy")).toContain("Couldn&#x27;t remove the person model: busy");
  });

  test("while its state loads, it says so", () => {
    expect(fields(null)).toContain("Checking the person model…");
  });
});

describe("the person model's state", () => {
  // The model on a fake backend whose state is `info`, and a clock the test runs.
  function setUp(info: PersonModelInfo) {
    const world = { info, read: 0, asked: [] as PersonModelAction[], refuse: null as ApiError | null };
    const timers: (() => void)[] = [];
    const source = new PersonModelSource({
      read: async () => {
        world.read += 1;
        return world.info;
      },
      download: async () => {
        world.asked.push("download");
        world.info = model("downloading");
        return world.info;
      },
      cancel: async () => {
        world.asked.push("cancel");
        world.info = model("absent");
      },
      remove: async () => {
        world.asked.push("remove");
        if (world.refuse) throw world.refuse;
        world.info = model("absent");
      },
      after: (ms, run) => {
        expect(ms).toBe(PERSON_MODEL_POLL_MS);
        timers.push(run);
        return () => void timers.splice(timers.indexOf(run), 1);
      },
    });
    const tick = async () => {
      const due = timers.splice(0);
      for (const run of due) run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { world, source, timers, tick };
  }

  test("is polled while it downloads, and no more once it is here", async () => {
    const { world, source, timers, tick } = setUp(model("absent"));
    await source.load();
    expect(source.state.model?.state).toBe("absent");
    expect(timers).toHaveLength(0);
    await source.act("download");
    expect(world.asked).toEqual(["download"]);
    expect(source.state.model?.state).toBe("downloading");
    expect(timers).toHaveLength(1);
    world.info = model("downloading", { done: 9_000_000 });
    await tick();
    expect(source.state.model).toEqual(model("downloading", { done: 9_000_000 }));
    expect(timers).toHaveLength(1);
    world.info = model("ready", { done: TOTAL });
    await tick();
    expect(source.state.model?.state).toBe("ready");
    expect(timers).toHaveLength(0);
  });

  test("Cancel stops the download and the polling; the section closed stops the polling", async () => {
    const { world, source, timers } = setUp(model("downloading"));
    await source.load();
    expect(timers).toHaveLength(1);
    await source.act("cancel");
    expect(world.asked).toEqual(["cancel"]);
    expect(source.state.model?.state).toBe("absent");
    expect(timers).toHaveLength(0);

    const other = setUp(model("downloading"));
    await other.source.load();
    other.source.dispose();
    expect(other.timers).toHaveLength(0);
  });

  test("Remove deletes it; a refusal is told", async () => {
    const { world, source } = setUp(model("ready"));
    await source.load();
    world.refuse = new ApiError(409, "The person model is being downloaded: cancel the download first");
    await source.act("remove");
    expect(source.state.message).toBe("Couldn't remove the person model: The person model is being downloaded: cancel the download first");
    expect(source.state.model?.state).toBe("ready");
    world.refuse = null;
    await source.act("remove");
    expect(source.state.message).toBeNull();
    expect(source.state.model?.state).toBe("absent");
  });
});
