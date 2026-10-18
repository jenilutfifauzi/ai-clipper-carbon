# 14: Phone

**Parent spec:** `spec.md` in this feature folder (user stories 21, 57; Solution, all of the editor's parts); GLOSSARY "Advanced Edit".

**What to build:** on a phone, the owner mixes with the toolbar and the bottom sheets, as on the desktop:
- mutes and unmutes the Pick;
- Detaches and Reattaches;
- fades a Segment;
- sets a Music Clip's Speed and Ducking.

The Meters stay desktop only.

- **Toolbar.** A Mute button for the Pick, with M's rule (any heard → all Muted; all Muted → unmuted). It is disabled when the Pick has no sound.
- **Bottom sheets.**
  - **A Segment's:** fades, Muted, Detach audio or Reattach audio.
  - **A Music Clip's:**
    - Speed, pitch and Reverse;
    - Muted;
    - Duck under speech and its depth;
    - "Detached from Segment N" with Reattach.
  - **A video Overlay's:** Muted.
- **Timeline.** The Muted look, a Segment's Fade Ramps and the ducked shading show on the phone's Timeline as on the desktop. Fade handles can be dragged at touch size.
- **Save sound as WAV** is in the item's sheet, where the phone's browser allows a download.

**Blocked by:** 03, 05, 09, 11.

**Status:** ready-for-agent

- [ ] On a phone-sized viewport, the toolbar's Mute toggles the Pick by M's rule.
- [ ] A Segment's sheet sets its fades, mutes it, and Detaches and Reattaches it.
- [ ] A Music Clip's sheet sets its Speed, Muted and Ducking, and shows Reattach on a Detached sound.
- [ ] Fade handles are draggable by touch.
- [ ] `npm run typecheck && npm run build` pass.
