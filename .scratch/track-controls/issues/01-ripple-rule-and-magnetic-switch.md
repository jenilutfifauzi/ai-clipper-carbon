# 01: Deleting Segments ripples the layers, behind a Magnetic switch

**Parent spec:** `spec.md` in this feature folder (user stories 28–31, 35–39, 42–44, 49, 66–67; Implementation Decisions "One pure ripple rule", "Actions that ripple", "MCP"). See docs/adr/0004-layers-ripple-with-the-main-track.md.

**What to build:** with the Magnetic timeline on, deleting Segments in the Advanced Edit makes the Text Layers, Music Clips, Overlays and the hook follow the Main Track, in one undo step.

- **The ripple rule** is a pure function in the actions module. It takes the edits, the Clip's duration and a list of Main Track changes in Timeline time: removals of [a, b) and insertions of L at t. Changes are applied from the latest to the earliest. Per item spanning [s, e):
  - **e ≤ a:** unchanged.
  - **s ≥ b:** moved up by b − a.
  - **s < a < e:** loses the overlap with [a, b). A song's or video's offset is unchanged.
  - **a ≤ s < b < e:** starts at a and ends at e − (b − a). The offset is advanced by b − s.
  - **a ≤ s and e ≤ b:** deleted.
  - **Too short:** an item left shorter than the shortest item length is deleted.
  - **The hook:** never deleted. Wholly inside, it moves to start at a. It is never shorter than its minimum.
  - **Insertions:** items with s ≥ t move back by L, and items across t stay. Insertions are only used from ticket 03 on, but the rule handles them now.

  It returns the new edits and the count of deleted layers by kind.
- **The actions module's context gains `magnetic`.** With it on, **remove** turns each removed Segment into a removal span:
  - the span sits at the Segment's played start;
  - its length is the played Clip's loss, Transitions included.

  The notice counts the layers deleted. With it off, remove behaves as today.
- **The Magnetic switch** sits in the Timeline's bar beside Split, with its tooltip ("Deleting, trimming or inserting Segments moves the layers with them").
  - It is a browser preference in local storage, true when absent or unreadable.
  - Every read and write is guarded.
  - The Advanced Edit passes it to the actions.
- **The MCP server's instructions** gain one point under Edits: removing or trimming Segments, or changing `start`/`end`, leaves Text Layers, Music Clips, Overlays and the hook where they are in Timeline time. The editors move them while their Magnetic timeline is on, so an agent moves them itself when they should follow.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam D, a three-Segment Clip with its middle Segment removed, magnetic on:
  - [ ] a layer before it is unchanged;
  - [ ] a layer after it moves up by the Segment's played length;
  - [ ] layers across its start and across its end are shortened, with a song's offset advanced only when its start was cut;
  - [ ] a layer inside it is deleted and counted in the notice;
  - [ ] the hook inside it moves to the join;
  - [ ] a layer left shorter than the minimum is deleted.
- [ ] Seam D: magnetic off, the same remove leaves every layer as it is.
- [ ] Seam D: several Segments removed at once move the layers as if removed one at a time from the latest.
- [ ] Seam D: a Segment removed with its Transition moves the layers by the Clip's actual loss.
- [ ] Seam D: an insertion moves the later layers back, and leaves the ones across its point as they are.
- [ ] The switch is on by default, survives a reload, and still works with blocked storage.
- [ ] One undo brings back the Segment and every layer it moved or deleted.
- [ ] The MCP instructions carry the new point, and the backend's tests pass.
- [ ] `npm run typecheck`, `npm test`, `npm run build`.
