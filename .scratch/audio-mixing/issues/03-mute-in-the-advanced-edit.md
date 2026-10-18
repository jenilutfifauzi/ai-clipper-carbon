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

**Status:** done

- [x] M on a Pick of a heard Segment and a Muted Music Clip mutes both; M again unmutes both; each is one undo step.
- [x] M on a Pick holding only a Text Layer and a Shape changes nothing and adds no undo step.
- [x] The inspector's Muted switch reflects and sets the flag for a Segment, a Music Clip and a video Overlay.
- [x] A Muted item on the Timeline shows a flat dimmed Waveform, a crossed speaker, and no Volume Line or Fade Ramps.
- [x] A video Overlay added from the assets is volume 1 and Muted; unmuting it is heard at full level in the preview.
- [x] Editor action tests cover the mixed Pick and the ignored kinds; `npm run typecheck && npm run build` pass.

## Comments

**2026-10-18: done.** Built test first in `frontend/src/pages/job/advanced/mute.test.ts` (the action, its key and command, and `newOverlay`).

**What was built:**
- **Action** (`actions.ts`). `toggleMute(scene, sounded)`: the picked items with sound are all Muted when any is heard, else all unmuted, as one change (one undo step), keeping their volume, Keyframes and fades; the Pick stays.
  - Items with sound: Segments that aren't Freeze frames (a video's only when its item `has_audio`), every Music Clip, and video Overlays whose item has sound.
  - Text Layers, Shapes, images, Freeze frames, silent videos, the hook, the captions and a join are left alone, and don't count as heard. With none left it is null: no change, no undo step.
- **Key** (`keymap.ts`, `commands.ts`). The `mute` row, M, under Editing on the shortcut sheet: "Mute the picked items with sound, or unmute them when all are Muted". `commandsOf` takes a `mute` command; AdvancedEdit runs `toggleMute` with `mediaById`'s `has_audio` and applies its outcome, and leaves M to the browser when nothing with sound is picked. Not desktop-only, as R isn't; the phone's toolbar button is 14's.
- **Inspector.** `MutedSwitch` (`KeyCluster.tsx`, beside `KeyedVolume`): the shared `Switch` labelled "Muted" with an M key cap (hidden in the phone's sheets), as the Reverse switch has R. It sets `muted` through each item's own `onChange`, one history group per item (`segment:<id>:muted`, `music:<id>:muted`, `overlay:<id>:muted`):
  - a Segment (`SegmentFields`): under its sound's volume, for the Source's and a video's with sound; none on a Freeze frame or a silent video;
  - a Music Clip (`MusicFields`): under its volume;
  - a video Overlay with sound (`OverlayFields`): under "Its sound". Its readout no longer says "Muted" at volume 0: it says "Muted · 100%" when the flag is set, and the percentage otherwise.
- **Timeline** (`Tracks.tsx`, `waveform.ts`).
  - A Muted Segment or Music Clip has its Waveform drawn flat and dimmed (`waveformLayer`'s `muted`: a 1 px line along the middle at 40 %, over the band's backdrop, where its Peaks have arrived), and no Volume Line nor Fade Ramps.
  - A Muted Segment, Music Clip or Overlay shows a crossed speaker (`MutedBadge`, lucide's `VolumeX`, styled as the Speed badge) and ", Muted" in its accessible name. A Freeze frame never looks Muted.
- **New video Overlays** (`newOverlay`, which the asset panel's add and a drop on the Overlay Track both use) are made at volume 1 and Muted. An image's stays at volume 0, without `muted`. Stored Overlays and the model's default are unchanged.
- **Track mute is unchanged**: its tooltip still says the clip is heard with it, and `heardDraft` still mutes by volume 0.

**Decided differently / worth knowing:**
- **R on a Music Clip** (07) looked the Music Clip up among the Overlays, so it always turned Reverse on. The `reverse` command now finds the item in its own list (`LISTS`), and R's sheet line names the Music Clip too. A one-line fix beside M's wiring.
- **"A paste of a new item":** every new Overlay the editor makes goes through `newOverlay`. No paste makes a new Overlay from outside the Clipboard, and a Clipboard paste keeps the copied Overlay's volume and `muted`, as before.
- **Checked in a browser** (ego-browser, desktop; a copy of a review Job in a scratch data dir, the backend on its own port):
  - M on the Source Segment Muted it (switch on, crossed speaker, flat Waveform, no Volume Line); M again unmuted it; Cmd+Z undid each press one at a time.
  - A video Overlay added from the Media tab came in at 100 % and Muted ("Muted · 100%", crossed speaker). Its switch unmuted it, saved as `volume: 1, muted: false`.
  - A Pick of a song, that Overlay and the Segment was Muted by one M (the song flat and dimmed, without its Volume Line or Fade Ramps) and unmuted by the next.
  - The shortcut sheet lists M.
  - Hearing the unmuted Overlay at full level rests on 02's preview (`loudness` and `followCurve` read `muted`), not on listening.
- **Tests:** `mute.test.ts` (13): the mixed Pick both ways, one change each; volume, Keyframes and fades kept; a video Segment and a video Overlay; the ignored kinds (Text Layer, Shape, Freeze frame, silent video, image), which don't count as heard; one heard item Mutes them all; only a Text Layer and a Shape gives null; the hook, captions, a join and nothing give null; M in either case, Cmd+M and typing; the sheet; the command; `newOverlay` for a video and an image. `commands.test.ts` passes the new `mute`.
