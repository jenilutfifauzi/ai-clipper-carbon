import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "../../../../format";

// Compact styles for a chat bubble, after open-pencil's markdown.css. Each drops react-markdown's
// `node` so it doesn't land on the element.
const COMPONENTS: Components = {
  h1: ({ node: _, ...props }) => <h1 className="text-base font-semibold" {...props} />,
  h2: ({ node: _, ...props }) => <h2 className="text-sm font-semibold" {...props} />,
  h3: ({ node: _, ...props }) => <h3 className="text-sm font-semibold" {...props} />,
  h4: ({ node: _, ...props }) => <h4 className="text-sm font-semibold" {...props} />,
  ul: ({ node: _, ...props }) => <ul className="list-disc space-y-0.5 pl-4" {...props} />,
  ol: ({ node: _, ...props }) => <ol className="list-decimal space-y-0.5 pl-4" {...props} />,
  a: ({ node: _, ...props }) => <a target="_blank" rel="noreferrer" className="text-text underline decoration-text/40 hover:decoration-text" {...props} />,
  blockquote: ({ node: _, ...props }) => <blockquote className="border-l-2 border-border pl-2 text-muted" {...props} />,
  hr: ({ node: _, ...props }) => <hr className="border-border" {...props} />,
  // Inline code; a block's code (in `pre`) drops the chip.
  code: ({ node: _, ...props }) => <code className="rounded bg-fill px-1 font-mono text-[0.9em]" {...props} />,
  pre: ({ node: _, ...props }) => (
    <pre className="overflow-x-auto rounded-lg bg-bg/60 p-2 font-mono text-xs [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-xs" {...props} />
  ),
  table: ({ node: _, ...props }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => <th className="border border-border px-2 py-1 text-left font-medium" {...props} />,
  td: ({ node: _, ...props }) => <td className="border border-border px-2 py-1 align-top" {...props} />,
};

/**
 * The Agent's text as Markdown, with GitHub's tables, task lists and strikethrough. Raw HTML is
 * shown as text, never rendered. While it streams (`streaming`), whatever has come in renders (an
 * unclosed fence as code), each new block and list item fading in as open-pencil's do: react-markdown
 * keeps the elements already there, so only the new ones animate.
 */
export function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div
      data-markdown=""
      className={cx(
        "space-y-2 text-pretty break-words",
        streaming && "[&_li]:motion-safe:animate-[fade-in_200ms_ease-out] [&>*]:motion-safe:animate-[fade-in_200ms_ease-out]",
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
