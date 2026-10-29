// .scratch/agent-chat-ui/issues/02-markdown.md: the Agent's text renders as Markdown, never its raw HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  test("bold, a list, a table and a link that opens in a new tab", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={"**x**\n\n- a\n- b\n\n| k | v |\n| - | - |\n| 1 | 2 |\n\n[docs](https://example.com)"} />);
    expect(html).toContain("<strong>x</strong>");
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("<table");
    expect(html).toMatch(/<a[^>]*target="_blank"[^>]*rel="noreferrer"/);
  });

  test("raw HTML is text, never an element", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={'<script>alert("x")</script>\n\nok'} />);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  test("a fence still streaming renders as code", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={"```json\n{\"a\": 1"} />);
    expect(html).toMatch(/<pre[^>]*><code/);
  });
});
