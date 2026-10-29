# 02: Markdown in the Agent's text

**Parent spec:** `spec.md` (Solution 2).

**Status:** ready-for-agent

**Blocked by:** 01

**What to build**
- Add `react-markdown@10.1.0` and `remark-gfm@4.0.1` to `frontend/package.json`.
  - The worktree's `frontend/node_modules` is a symlink to the main checkout's. Install with `npm install` in the **main checkout's** `frontend/`, using `--no-save`, so that only the worktree's `package.json` and lockfile change. Alternatively, run `npm install` in the worktree with the symlink in place and confirm that only `package.json` and `package-lock.json` changed in git.
- New file `agent/ChatMarkdown.tsx` wrapping `<ReactMarkdown remarkPlugins={[remarkGfm]}>`. Raw HTML is never rendered (the react-markdown default).
  - Links get `target="_blank" rel="noreferrer"` and `text-accent-text underline`.
  - Compact styles, ported from `<main>/docs/referensi/open-pencil-master/src/theme/markdown/markdown.css`:
    - paragraphs are spaced with `space-y-2`;
    - `ul` and `ol` use `pl-4` with list markers;
    - inline code is `rounded bg-fill px-1 font-mono text-[0.9em]`;
    - code blocks are `rounded-lg bg-black/30 p-2 text-xs overflow-x-auto` (use a token-based colour that also works in light mode);
    - tables are `text-xs` with borders and `px-2 py-1` cells, inside an `overflow-x-auto` wrapper;
    - headings are small: h1 `text-base`, h2 and h3 `text-sm font-semibold`.
  - Apply them through the `components` prop or one scoped CSS block in `index.css` under `[data-markdown]`; pick whichever fits the codebase better.
- In `TurnView`, the Agent's text part renders `<ChatMarkdown text=… />` instead of pre-wrap text. User prompts stay plain text.
- Streaming: render whatever text exists. An unclosed fence renders as code, which is fine.

**Acceptance**
- [ ] A test in `agentTab.test.tsx` (or a new `chatMarkdown.test.tsx`): `**x**` renders a `<strong>`, a `- a` list renders `<li>`, and a raw `<script>` is not rendered as an element.
- [ ] typecheck and agent tests pass, and `npm run build` still succeeds.
