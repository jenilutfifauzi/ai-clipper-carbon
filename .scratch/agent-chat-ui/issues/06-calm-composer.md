# 06: A calmer composer, and no orange in the chat

**Parent spec:** `spec.md` (Solution 1, revised).

**Status:** ready-for-agent

**Blocked by:** 01, 05

**Why:** the owner wants the composer to look like a Codex/Claude-style input, and the chat to drop the loud orange. The orange stays everywhere else in the app (Export and the rest). The Agent's presence cursor on the Timeline and preview keeps it too.

## What to build (`frontend/src/`)

**`components/Button.tsx`**
- A variant `solid`: `bg-text text-bg hover:opacity-90`, a neutral high-contrast button (white on dark, black on light).
- A size `icon-round`: `size-8 shrink-0 rounded-full`.

**`agent/Composer.tsx`**
- Layout:
  - the outer box is `px-3 pt-1 pb-3` with no top border;
  - the composer box is `rounded-2xl border border-border bg-fill`, and on focus becomes `focus-within:border-text/25`, with no orange ring.
- Textarea:
  - `text-base`, so it is 16px and iOS doesn't zoom;
  - it sits inside a `<form>` whose submit sends;
  - Enter sends and Shift+Enter breaks the line, as before.
- Toolbar, left to right:
  1. the Provider pill (Bot icon, label, chevron), opening the Provider select;
  2. `ml-auto` the Model pill (model name and chevron, only when the provider has models), opening the Model select;
  3. the gear, whose pressed state is neutral;
  4. a round Send (`solid icon-round`, `type="submit"`, disabled while the text is empty), or a round Stop while a turn runs.

**Taking the orange out of the chat**
- The user bubble becomes `raised text-text`.
- The Follow toggle and the active Thread's check become neutral.
- `ListChecks` and Brain become `text-muted`.
- The chosen choice becomes `border-text/40 bg-fill`, and Emphasis in labels becomes `text-text`.
- The `info` callout becomes `text-waiting`.
- Markdown links and the ProviderSetup docs link become `text-text underline decoration-text/40`.
- ProviderSetup's Save becomes `solid`.

## Seams under test (TDD, `renderToStaticMarkup`)
1. **Composer markup:**
   - the toolbar order is Provider, Model, gear, Send;
   - Send is disabled while the text is empty;
   - while a turn runs there is a Stop and no Send;
   - the textarea is inside a `<form>`.
2. **No orange:** the markup of Composer, TurnView (user bubble), ChoicesCard (chosen option, Emphasis) and ChatHeader (Follow pressed) never contains `accent`.
3. **Input ≥16px:** the textarea uses `text-base`.

## Acceptance
- [ ] The tests at the three seams pass. Only `npx vitest run src/pages/job/advanced/agent` and `npx tsc --noEmit` are run; the known `vite.config.ts` error remains.
- [ ] Checked in the browser, dark and light: the composer matches the reference, and no orange is left in the chat.
