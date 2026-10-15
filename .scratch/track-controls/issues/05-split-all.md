# 05: Split all at the playhead

**Parent spec:** `spec.md` in this feature folder (user stories 57–58, 60–65; Implementation Decisions "Split all").

**What to build:** with nothing picked, Cmd/Ctrl+B or the Split button splits every Segment, Text Layer, Music Clip and Overlay under the playhead, as one undo step.

- **The split.** It is an action in the module: every item whose span holds the playhead is cut by today's per-kind rules. A Source Segment is cut in the silence between Words. A song's or video's second part goes on from where the first stops.
- **The hook is never split.** The captions break their lines at the new join, as at every join.
- **The second parts** become the Pick.
- **With a Pick,** Split works on the picked items as today.
- **The Split buttons** in the Timeline's bar and the phone's toolbar are enabled when either split can apply: something picked under the playhead, or nothing picked and something under it.
- Ticket 07 makes split all skip locked Tracks.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] with an empty Pick, every Segment, Text Layer, Music Clip and Overlay under the playhead is cut, and items not under it are not;
  - [ ] a Source Segment is cut in the silence between Words;
  - [ ] the hook is untouched;
  - [ ] the tails are the Pick.
- [ ] Cmd/Ctrl+B with nothing picked, the desktop Split button and the phone's Split button all split all, in one undo step.
- [ ] `npm run typecheck`, `npm test`, `npm run build`.
