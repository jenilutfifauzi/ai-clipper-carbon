# 01: The + menu and text-file attachments, end to end

**Parent spec:** `spec.md`

**What to build:** the owner clicks **+** in the Agent composer, picks **Add text file**, chooses a .txt/.md/.srt/.vtt/.json/.csv file, sees it as a chip above the message box (removable with ×), and sends. The Agent receives the file's text as a `<context kind="text" name="…">` block before the prompt. The sent message's bubble shows the chip, also after a reload. This ticket lays the whole Agent Attachment path (request schema, context resolution, turn context, transcript, chip row, menu) that tickets 02–04 extend; their menu items need not exist yet.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] GLOSSARY gains **Agent Attachment** under Agent Mode; the agent-chat-ui and agent-mode specs' "no image buttons / image attachments out of scope" lines point to this spec
- [ ] The turn request accepts `attachments` (discriminated on `kind`, at most 6); `text` items over 50 KB are refused with 422; a request without `attachments` works as before
- [ ] A new backend module resolves attachments into context text placed before the prompt the driver sees; the stored prompt stays the owner's text
- [ ] Agent Turn records keep `attachments` (`kind`, `name`); transcripts without it still load; the transcript API returns them
- [ ] Composer: a `Plus` ghost icon button first in the toolbar, labelled "Add to message", opens a `Menu` (useMenu) with **Add text file**; a hidden file input; a chip row above the textarea with × per chip; inline error for a file too big or not text; attachments cleared on successful send, kept on failure; limit of 6 told inline
- [ ] The Agent tab sends `attachments` with `sendAgentTurn`; the owner's bubble shows the turn's chips
- [ ] Tests at the agreed seams: `/turns` with a fake driver recording the context; transcript round-trip; composer test (menu, chip, remove, error, payload); Agent tab test (payload, bubble chips)
- [ ] Only the feature's tests run; `npm run typecheck` passes
