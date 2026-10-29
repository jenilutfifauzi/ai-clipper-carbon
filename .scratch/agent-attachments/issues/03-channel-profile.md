# 03: Attach the Channel Profile

**Parent spec:** `spec.md`

**What to build:** in the + menu, **Channel Profile** adds a chip in one click; on send the backend inlines the Channel Profile's JSON before the prompt as `<context kind="channel_profile" name="Channel Profile">`. The item is disabled while attached.

**Blocked by:** 01

**Status:** done

- [x] The request accepts `{kind: "channel_profile"}` at most once (twice → 400)
- [x] The driver's prompt carries the profile as the `/profile` route returns it
- [x] Menu item with lucide `UserRound`, disabled while attached; chip and bubble chip read "Channel Profile"
- [x] Tests: `/turns` fake-driver test; composer test (item disabled after attaching)
