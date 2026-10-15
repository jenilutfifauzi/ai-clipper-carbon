# 06: Track headers, with hide and mute in the preview

**Parent spec:** `spec.md` in this feature folder (user stories 1–3, 5–17; Implementation Decisions "Track state", "Hide and mute reach the preview only", "Track headers").

**What to build:** on a desktop, each Track of the Advanced Edit's Timeline has a header with its hide and mute buttons. Hiding or muting a Track changes the preview and nothing else.

- **Track state** is a value held by the Advanced Edit beside the Pick. It is never saved or undone, and starts with every Track on. Its shape: the Tracks hidden (text, overlay, video, captions, hook), the Tracks muted (overlay, video, music), and the Tracks locked (any of the six, used by ticket 07).
- **Headers.**
  - Each Track's first row (Text, Overlay, Video, Captions, Hook, Music) carries its label and the buttons the matrix gives it:

    | Track | Hide | Mute |
    |---|---|---|
    | Text | ✓ | – |
    | Overlay | ✓ | ✓ |
    | Video | ✓ | ✓ |
    | Captions | ✓ | – |
    | Hook | ✓ | – |
    | Music | – | ✓ |

  - The Captions and Hook rows get headers like the others.
  - The buttons have accessible names and pressed states.
  - The tooltip says that the Clip still renders everything.
- **Hide.**
  - A hidden Track's items are dimmed on the Timeline.
  - In the preview, hidden Text Layers, Overlays, captions and hook aren't drawn. A hidden Video Track draws black under the layers.
  - Hidden stage items can't be picked on the preview.
- **Mute.**
  - Video silences the Clip's own sound (the Source and media Segments).
  - Music silences the songs.
  - Overlay silences the Overlay videos' sound.
- **No change to the Preview Plan request or the render.**

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Each hide and mute button changes exactly its Track in the preview, and turns back off.
- [ ] A hidden Track's items stay on the Timeline, dimmed, and its stage items can't be clicked.
- [ ] Hide and mute are gone after a reload, and never enter the undo history.
- [ ] A Clip rendered with a Track hidden and another muted is complete.
- [ ] `npm run typecheck`, `npm test`, `npm run build`.
