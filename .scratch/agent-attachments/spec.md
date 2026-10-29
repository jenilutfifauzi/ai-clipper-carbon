# Agent Attachments: a + menu in the Agent composer

**Status:** ready-for-agent

## Problem Statement
The owner can only type to the Agent. They can't show it what went wrong (a screenshot of a bad caption, a frame with the hook in the wrong place), can't point at another Candidate and say "edit this one like that", and can't hand it a brief or a brand style guide without pasting it into the message box. The Agent's Scoped MCP server refuses to read any Candidate but the open one, so "copy the style of clip 3" can't work today at all.

## Solution
A **+** button at the left of the composer's toolbar opens a menu:
- **Upload image**: one or more pictures the model sees (vision), such as a screenshot of the edit to fix or a reference look.
- **Add text file**: a .txt, .md, .srt, .vtt, .json or .csv file whose text goes with the message (a brief, a style guide, a script).
- **Reference a clip**: another Candidate of this Job, whose edit (hook, Kicker, Layout, Style Preset, Style Overrides, captions, Text Layers, Transitions…) goes with the message as a style reference.
- **Channel Profile**: the Channel Profile, inlined with the message.

Images can also be pasted or dropped into the message box. What's attached shows as a row of chips above the text (a thumbnail for an image, an icon and name otherwise), each with a × to remove it. After sending, the chips show in the owner's bubble in the chat, and still show after a reload. There is no web or URL option.

## User Stories
1. As an owner, I want a + button in the composer, so that I can attach things to my message without leaving the Agent tab.
2. As an owner, I want the + to open a menu naming each kind of attachment, so that I know what I can give the Agent.
3. As an owner, I want to upload a screenshot of my clip, so that the Agent can see exactly what's wrong and fix it.
4. As an owner, I want to upload a reference picture of a caption look I like, so that the Agent can style my captions like it.
5. As an owner, I want to attach several images at once, so that I can show a before and an after.
6. As an owner, I want to paste an image from my clipboard into the message box, so that a screenshot goes in without saving a file.
7. As an owner, I want to drop an image file onto the composer, so that attaching is one gesture.
8. As an owner, I want each attached image as a small thumbnail chip, so that I can check I picked the right one.
9. As an owner, I want to remove an attachment with its ×, so that a wrong pick doesn't go out.
10. As an owner, I want to attach a text file such as a brief or a style guide, so that the Agent follows it without me pasting it in.
11. As an owner, I want a text attachment's chip to show its file name, so that I know which file is attached.
12. As an owner, I want to reference another Candidate of this Job, so that the Agent can make this clip match that one's style.
13. As an owner, I want the clip picker to list the Job's other Candidates by their hook and time, so that I can tell them apart.
14. As an owner, I want the open Candidate left out of the clip picker, so that I can't reference the clip I'm editing.
15. As an owner, I want to attach the Channel Profile in one click, so that the Agent edits in my channel's style.
16. As an owner, I want the Channel Profile item disabled once it's attached, so that I don't attach it twice.
17. As an owner, I want a clear message when an image is too big or not a picture, so that I know why it wasn't attached.
18. As an owner, I want a clear message when a text file is too big or not text, so that I know why it wasn't attached.
19. As an owner, I want a limit on how many things I can attach, told to me when I reach it, so that a message can't grow without bound.
20. As an owner, I want attachments cleared with the text once my message is sent, so that the next message starts clean.
21. As an owner, I want attachments kept when sending fails, so that I can retry without re-attaching.
22. As an owner, I want my sent message's bubble to show its attachments as chips, so that I remember what I gave the Agent.
23. As an owner, I want those chips still there after a reload, so that the Thread's history is complete.
24. As an owner, I want an image chip in the chat to show the picture I sent, so that I can see it again.
25. As an owner using an Agent Provider that can't see images, I want a clear error naming the provider, so that I can switch to one that can.
26. As an owner, I want images to work with Claude Code, Codex, Gemini CLI and the API providers alike where the model supports them, so that the provider doesn't change the feature.
27. As an owner, I want a message to still need text, so that the Agent always gets an instruction with what's attached.
28. As a keyboard user, I want the + menu reachable and operable with the keyboard, with Escape closing it, so that I don't need a mouse.
29. As a screen-reader user, I want the + button, its items and each chip's × labelled, so that I know what each does.
30. As an owner, I want the Agent to still edit only the open Candidate, so that referencing another clip never changes it.

## Implementation Decisions
- **Glossary:** a new Agent Mode term, **Agent Attachment**: an image or a piece of context that goes with one Agent Turn (an image the model sees, a text file's text, another Candidate of the Job, or the Channel Profile). The specs that ruled out images in the composer (agent-chat-ui's "no pointer or image buttons", agent-mode's out-of-scope image attachments) are updated to point here.
- **Turn request:** the turn's request body gains `attachments` (at most 6), each a discriminated union on `kind`:
  - `image`: `name`, `media_type` (image/png, image/jpeg, image/webp, image/gif), `data` (base64), at most 5 MB of base64 (Anthropic's limit, about 3.75 MB decoded). The browser sends a picture as it is while it fits and its long edge is at most 2048 px; else it draws it with that long edge at most 2048 px and re-encodes it as JPEG, refusing it only if it is still too big. A picture over 30 MB isn't attached at all;
  - `text`: `name`, `text`, at most 50 KB of UTF-8 (read in the browser with `File.text()`, and measured, as the backend measures it, after decoding);
  - `candidate`: `candidate_id`, another Candidate of the same Job (unknown → 404; the open one → 400);
  - `channel_profile`: no fields, at most once.
  The prompt still needs at least one character.
- **Resolving context (backend):** a new deep module that takes the Job's store, the Job and the open Candidate, and the attachments, and returns the context text and the images. Each context attachment becomes a block `<context kind="…" name="…">…</context>`, placed before the owner's prompt in what the driver sees (a closing `</context` inside its body is written `<\/context`, so a file can't end its block early):
  - a referenced Candidate becomes a JSON summary of its edit: the same shape `get_candidate` returns, without range-specific bulk where that helps (it is a style reference, not something to edit);
  - the Channel Profile becomes its JSON, read the way the `/profile` route reads it.
  The referenced Candidate is read by the backend for the owner, so the Scoped MCP server's rule (only the open Candidate) is unchanged.
- **Turn context:** gains `images` (each a media type and base64 data), for the current message only. The stored prompt stays the owner's own text, without the context blocks; the turn's record keeps the context blocks apart (`context`), and an API provider's history gives each earlier turn's message as its context then its prompt, without its images. The chat shows the prompt alone.
- **ACP agents:** the prompt's content blocks gain `{"type": "image", "mimeType", "data"}` after the text when the agent's `initialize` answer advertises `agentCapabilities.promptCapabilities.image`. Otherwise the turn is refused before it starts with "<Provider> can't see images".
- **API providers:** the user message of the current turn carries its images in each adapter's own form: Anthropic image blocks with a base64 source; OpenAI-compatible chat `image_url` parts with a data URL; Gemini `inline_data` parts. Earlier turns stay text only. Each API provider says whether it `sees_images` (DeepSeek doesn't); images to one that doesn't are refused with 400 "<Provider> can't see images" before anything is kept, and the composer turns Upload image off (and refuses a pasted or dropped image) with that reason.
- **Transcript:** each Agent Turn record gains `attachments`: `kind`, `name`, and for an image an `id`. Images are saved with the Job (under its agent folder) by that id, and deleted again when the turn then can't start (one already running, 409); a new GET route on the Candidate's agent router serves one for its thumbnail. Old transcripts without the field still load.
- **Composer:** a ghost icon button with lucide `Plus`, first in the toolbar, labelled "Add to message", opens a menu built with the existing `useMenu` and `Menu` (native popover). Items with lucide icons: `ImageUp` Upload image, `FileText` Add text file, `Clapperboard` Reference a clip (opens the list of the Job's other Candidates), `UserRound` Channel Profile. Hidden file inputs back the two upload items. A chip row sits above the textarea; validation errors show inline under it. The composer takes the Job's Candidates and sends `onSend(prompt, attachments)`; the Agent tab converts images to base64 when sending. The data hooks and labels the tests rely on stay (`data-composer`, "Send", "Stop", "Message the Agent").
- **Chat:** the owner's bubble shows its turn's attachment chips; an image chip shows its thumbnail from the GET route.
- Colours and surfaces use the existing tokens; no new palette.

## Testing Decisions
- Test external behaviour only: what the driver receives for a request, what each provider is sent, what the owner sees and what the Agent tab posts. Not internal helpers.
- **Seams (agreed):**
  - Backend, the highest: the `/turns` route with a fake driver that records the turn context (prompt with context blocks, images), as the agent sessions tests already do; plus the transcript's `attachments` and the image GET route.
  - Each API adapter's message building, as the API adapter tests do today.
  - The fake ACP agent, taught to advertise (or not) image support and to record the prompt blocks it got, as the ACP tests do today.
  - Frontend: the composer test (the + menu, chips, removing, paste, limits, payload) and the Agent tab test (what `sendAgentTurn` is called with; chips in the bubble).
- Prior art: the agent sessions, API adapter and ACP tests in the backend; the composer and Agent tab tests in the frontend.
- Run only these tests (backend `tests/test_agent_*.py` files touched; frontend `npm run typecheck` and `npx vitest run src/pages/job/advanced/agent`), never the full suite.

## Out of Scope
- Browsing the web or attaching a URL.
- Putting attached images in the Media Library, or using them as Overlays.
- Images in earlier turns' history sent back to the model.
- Attaching Clips (rendered MP4s) or video frames other than as a picture the owner uploads.
- Letting the Agent edit a referenced Candidate.

## Further Notes
- Tickets: `issues/01` text files end to end → `02` Reference a clip, `03` Channel Profile, `04` images (each blocked by 01 only).
- Frontend skills to apply: emil-forms-and-inputs (file inputs, validation messages), emil-component-design (Composer's props), vercel-react-best-practices, impeccable for the polish pass.
