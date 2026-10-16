# 10: Phone: gestures and a Transform sheet

**Parent spec:** `spec.md` (user stories 48–50; Implementation Decisions "Advanced Edit inspector and phone"); ADR 0007.

**What to build:** on a phone, in the Advanced Edit:
- one finger moves a picked picture, a pinch scales it, and a two-finger twist rotates it, with the same snaps;
- the Grips are larger;
- a Transform sheet holds the inspector's fields (and Background or decoration), and Crop mode opens from it.

- **The gesture module** gains pinch and twist from two pointers.
- **One gesture is one step of undo.**

**Blocked by:** 05, 07

**Status:** ready-for-agent

- [ ] Seam H: two pointers moving to twice the distance and turning 30° give twice the scale and +30°; a twist near 90° snaps.
- [ ] Walkthrough on iPhone Safari: pinch, twist, the sheet's fields, and Crop mode, with no page zoom or scroll while gesturing.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
