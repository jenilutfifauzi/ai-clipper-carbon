# 03: Mute in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 14–17, 20–23, 58; Solution "Muted"; Implementation Decisions "Editor actions", "Timeline", "Inspector"); GLOSSARY "Muted".

**What to build:** on the desktop, the owner mutes and unmutes the picked items with M or with a switch in the inspector, and sees at a glance on the Timeline what is silent. A new video Overlay arrives Muted at full volume, so unmuting gives its sound at once. (The phone's toolbar comes in 14.)

- **M on the Pick** is one step of undo:
  - if any picked item with sound is heard, every one is Muted;
  - if all are Muted, every one is unmuted.

  Items without sound (Text Layers, Shapes, images, Freeze frames, the hook, the captions) are ignored. With none left, M does nothing. M is added to the shortcut sheet.
- **Inspector.** A Muted switch on a Segment (not a Freeze frame), a Music Clip and a video Overlay's sound. An Overlay shows "Muted" from the flag, no longer from volume 0.
- **The Timeline's Muted look:** the Waveform drawn flat and dimmed, no Volume Line nor Fade Ramps, and a crossed speaker on the item.
- **New video Overlays** (from the assets, a drop, or a paste of a new item) are made at volume 1 and Muted. Stored Overlays keep their volume 0.
- **Track mute is unchanged,** and its tooltip still says the Clip is heard with it.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] M on a Pick of a heard Segment and a Muted Music Clip mutes both; M again unmutes both; each is one undo step.
- [ ] M on a Pick holding only a Text Layer and a Shape changes nothing and adds no undo step.
- [ ] The inspector's Muted switch reflects and sets the flag for a Segment, a Music Clip and a video Overlay.
- [ ] A Muted item on the Timeline shows a flat dimmed Waveform, a crossed speaker, and no Volume Line or Fade Ramps.
- [ ] A video Overlay added from the assets is volume 1 and Muted; unmuting it is heard at full level in the preview.
- [ ] Editor action tests cover the mixed Pick and the ignored kinds; `npm run typecheck && npm run build` pass.
