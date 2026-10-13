# 09: Audio-signal mode (conditional)

**Parent spec:** `spec.md` in this feature folder (user story 67; Selection module, audio-signal mode).

> **Condition:** do this ticket only if ticket 08 ended without passing the gate. If the gate passed, this ticket is `wontfix`.

**What to build:** A flag (off by default) that sends each shortlisted Window's audio to the Detail pass alongside the text, so laughter, tone, and energy count toward selection. Then re-run the evaluation and compare the result with the best text-only version.

**Blocked by:** 08 (Selection gate).

**Status:** ready-for-agent

- [ ] With the flag off, behaviour is unchanged.
- [ ] With the flag on, audio is extracted for the shortlisted Windows only and attached to the Detail request. Free-tier limits are respected through the existing backoff and `waiting_quota` handling.
- [ ] Seam A test: with the flag on, the fake LLM receives audio parts for exactly the shortlisted Windows.
- [ ] An eval report is saved with the flag on, together with a comparison against the best text-only report.
- [ ] If the gate still fails: record the result, keep the better configuration as default, and proceed.
