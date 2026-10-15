# 07: Walkthrough: two tabs and the agent

**Parent spec:** `spec.md` in this feature folder (all user stories, end to end).

**What to build:** nothing new. This is a real session that checks edit sync the way it will be used: the owner in the browser, with the Advanced Edit and the clip editor in two tabs, while Claude Code edits the same Candidate through the MCP server.

**Script:**
1. Open a Job in review. Open one Candidate in the Advanced Edit in tab A and in the clip editor in tab B.
2. Ask Claude Code to add a Text Layer and a Music Clip to that Candidate.
   - Both tabs show them live, with a notice naming Agent and a highlight.
3. In tab A, drag a Text Layer while asking the agent to change a different one.
   - Both changes survive.
4. Ask the agent to change the Text Layer you are dragging.
   - Your change wins, and a collision notice appears.
   - Its Restore brings back the agent's version.
5. Undo in tab A.
   - Only your own steps are taken back.
6. Open History in tab B.
   - Entries are labelled Advanced Edit, Clip editor, Agent and Restore, with their changed parts.
   - Restore one, and both tabs update.
7. Render the Candidate, then change only Music in the Advanced Edit.
   - The Clip is marked stale.
8. Delete the Job from a third tab.
   - Both editors go read-only with a message.

**Blocked by:** 04, 05, 06.

**Status:** ready-for-human

- [ ] Every step behaves as described; anything that doesn't is filed as a new ticket in this folder.
