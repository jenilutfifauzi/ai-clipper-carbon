# 04: Images the model sees

**Parent spec:** `spec.md`

**What to build:** **Upload image** (and paste, and drop onto the composer) attaches png/jpeg/webp/gif pictures up to 5 MB as thumbnail chips. On send the images go to the model with the prompt: as ACP `image` content blocks when the agent advertises `promptCapabilities.image` (else the turn is refused with "<Provider> can't see images"), and in each API adapter's own image form. Images are saved with the Job; the bubble's image chips show their thumbnails from a GET route, also after a reload.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The request accepts `{kind: "image", name, media_type, data}`; wrong type → 422; over 5 MB decoded → 422
- [ ] Turn context gains `images` for the current message only; history stays text
- [ ] ACP: image blocks after the text when supported; a clear refusal when not (fake ACP agent taught both)
- [ ] Anthropic, OpenAI-compatible chat and Gemini adapters put the images in the current user message in their own forms
- [ ] Images saved under the Job; transcript `attachments` carries their `id`; a GET route on the Candidate's agent router serves one (404 for an unknown id)
- [ ] Composer: `ImageUp` **Upload image** (multiple), paste and drop of images, thumbnail chips via object URLs (revoked on remove/send), inline errors; the Agent tab base64-encodes them when sending
- [ ] Bubble image chips show the saved thumbnail
- [ ] Tests: `/turns` fake-driver (images in context, stored, GET); adapter tests; ACP tests; composer test (upload, paste, too big); Agent tab test (payload)
