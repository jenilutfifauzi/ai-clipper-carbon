# 06: Retimed copies, and a reversed media Segment

**Parent spec:** `spec.md` in this feature folder (user stories 17, 19, 22–23; Solution "Reverse"; Implementation Decisions "Retimed copies", "The renderer", "The preview"); ADR 0009, ADR 0005.

**What to build:** the agent can reverse a media Segment. Its range is reversed once into a Retimed copy, the preview plays that copy, and the render reads it, at the Segment's Speed. Through MCP; the Reverse switch comes in 08.

- **Retimed copies.**
  - A file of a range of a Source or media item, reversed, picture and sound, in two sizes: from the proxy (preview) and from the full video (render).
  - Made with ffmpeg in short pieces, each reversed, joined last to first, written under a temporary name and renamed when complete, so memory stays bounded at any length.
  - Kept beside the Job or the media item, named by kind, size and range in ms. Removed with their Job or item.
  - Lookup: any reversed copy of the same item and size whose range covers the one wanted, read from `b − d` for `c..d` of a copy of `a..b`.
  - Made off the Worker behind its own lock at low priority, latest request first, as Source chunks are (ADR 0005). Progress reported to the editor.
- **Model.** `reverse` on the Segment (false by default). Through the mapping, its left edge on the Timeline is the end of its range.
- **Renderer.** A reversed media Segment reads its full-size copy (making it inside the render if missing), then Speed and pitch as in 02.
- **Preview.** Switching Reverse on asks for the preview copy. The Segment plays the copy on its own video at its Speed. While the copy is being made it shows the first frame it will show, held, with "Reversing… n%", and the Timeline time runs on.
- **MCP.** `reverse` through the edit tools; the instructions' Reverse paragraph; the dry run says whether the copy is ready.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A reversed media Segment of the test video renders with its frame counter counting down and its tone sweep running backwards.
- [ ] At 2× and reversed, it lasts half its range and counts down by two.
- [ ] A copy of `a..b` serves a Segment of `c..d` inside it without making another; a range reaching outside makes a new one.
- [ ] Reversing a 3-minute range of a 1080p video keeps the process's memory under a set bound.
- [ ] A render with no copy makes the full-size one and succeeds; an interrupted copy leaves no file under the final name.
- [ ] The preview shows the held first frame with progress until the copy is ready, then plays it backwards at its Speed.
