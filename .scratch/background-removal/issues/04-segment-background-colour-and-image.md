# 04: A Segment's Background, colour and image

**Parent spec:** `../spec.md` ("Model", "Planner", "Renderer", "Preview", "Editor"); ADR 0015, 0007.

**What to build:** with Background removal on, the owner picks what shows behind the speaker: the picture blurred (the default), a colour, or an image from the Media Library filling the frame. This works in every Layout. The same image kind is offered for a media Segment's or a Manual Scene's Framing Background.

**The model:**
- `Background` gains the kind `image` with a Media Library image id. It fills 1080×1920 (cover, centred), with no Transform.
- A Source Segment gains an optional `background`. It is used only while Background removal is on, and when absent it reads as the picture blurred.
- A Media Library image a Background uses counts as used, so it can't be deleted.
- A missing image, or an item that isn't an image, is refused on save.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Seam B: the Background in force reaches the SegmentPlan, the Segment's own only with Background removal on, replacing a Blur Layout's fill; the dry run shows it.
- [ ] Seam A (fake matter): a frame shows the colour, or the image's pixels, outside the kept area; an image of another aspect covers the frame.
- [ ] The Inspector's Background picker (blur, colour, image) appears for a cut-out Source Segment and offers image for Framings; one step of undo each; on a mixed Pick and in the phone's sheet.
- [ ] The preview draws the colour or image under the cut.
- [ ] MCP sets `background` through the item patches; deleting a used image is refused.
