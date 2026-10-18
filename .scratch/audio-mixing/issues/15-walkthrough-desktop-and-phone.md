# 15: Walkthrough, desktop and phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions "Walkthrough"; roadmap section E).

**What to build:** a walkthrough of the whole feature in a real browser (the `run` skill or ego-browser), on the desktop and on a phone-sized viewport, then a render through the MCP tools. Anything found is fixed here or filed as a new ticket.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14.

**Status:** ready-for-agent

- [ ] Desktop: fade a Segment by its Fade Ramp and hear it.
- [ ] Desktop: key a Source Segment's volume on its Volume Line.
- [ ] Desktop: M on a mixed Pick.
- [ ] Desktop: add a video Overlay and unmute it.
- [ ] Desktop: Detach a Source Segment, slide its sound 1 s earlier for a J-cut, then Reattach.
- [ ] Desktop: add a song and hear and see it duck; change its depth.
- [ ] Desktop: set a Music Clip to 2× and to Reverse.
- [ ] Desktop: save a Segment's sound as WAV.
- [ ] Desktop: watch the Meters and latch the clip light.
- [ ] Phone: the same mute, fade, Detach and Ducking from the toolbar and sheets.
- [ ] MCP: `edit_candidate` with `dry_run=true` shows Muted, fades and ducked spans. `render_clips` → `list_clips` gives an MP4 whose mix matches the preview.
- [ ] Full backend suite, `npm run typecheck && npm run build` and the frontend tests pass.
