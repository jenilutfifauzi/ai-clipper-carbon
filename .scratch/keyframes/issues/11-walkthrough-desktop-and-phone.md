# 11: Walkthrough on desktop and phone

**Parent spec:** `spec.md` (Testing Decisions "By hand").

**What to build:** nothing new. Walk the whole feature in a browser, against rendered frames, and fix or file what is found.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10

**Status:** ready-for-agent

- [ ] Desktop, Chrome and Safari, each compared with the rendered Clip frame by frame at a few times:
  - [ ] a Ken Burns on an image Overlay;
  - [ ] a slide-in video Overlay with Ease out, rounded and bordered;
  - [ ] a spun logo, more than one turn;
  - [ ] a song dipped under a sentence, with its fades;
  - [ ] a media Segment zooming out over its Background through a Transition;
  - [ ] a Manual Scene panning between speakers, and the same piece shown twice;
  - [ ] a split, a trim and a ripple delete of keyed items;
  - [ ] the Dopesheet, the Curves and their Ease handles;
  - [ ] K, [ and ].
- [ ] Phone: the sheet's diamonds, auto-key, Ease picker and ruler diamonds.
- [ ] The agent: one motion made through MCP, checked with the dry run and a render.
- [ ] Render speed of a Clip with three keyed pictures noted.
