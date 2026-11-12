# Android native editor parity — Wayfinder map

## Destination

A native Android experience that covers the current AI Clipper Carbon mobile/web editor workflows, with an on-device editing and rendering path wherever practical. The destination is a clear, tested parity contract; this PR is one verified-or-explicitly-unverified vertical slice, not a claim of completion.

## Notes

- Stay with Expo/React Native and Android-native Kotlin modules; do not pivot to PWA/TWA.
- Keep final rendering on-device for phone-selected media. Existing FastAPI YouTube download, transcription, analysis, and Job workflow may remain server-backed.
- Keep Clerk secret material off-device; Clerk Native API setup and real-device/API auth validation remain outstanding.
- Existing web editor behavior and the repository's `.scratch/*/spec.md` documents are the domain reference. Reuse the `Candidate`, `Revision`, `Preview Plan`, `Cue`, `Hook`, `Watermark`, and `Timeline` vocabulary in `GLOSSARY.md`.
- The current PR remains open, unmerged, and undeployed. Seven moderate Expo toolchain advisories remain documented; do not resolve them by a major downgrade.
- This session's bounded implementation slice is manual timed text captions with evenly estimated per-word highlighting, a three-second hook, and an all-clip text watermark burned locally through Media3. This does not settle the full-parity decisions below.
- Jez confirmed this must be labeled a local-caption subset, not AI Candidate/transcript parity; connecting Candidate/transcript data to native editing and rendering is the next explicit parity gap.
- Wayfinder decisions are for Jez to relay to the owner; no decision ticket is resolved by this implementation session.

## Decisions so far

<!-- No Wayfinder decision tickets have been resolved. Existing implementation choices above are constraints already given for this effort. -->

## Not yet specified

- Cross-feature ordering, dependencies, and detailed acceptance thresholds that depend on the project identity, render-plan, and device-support decisions; graduate newly sharp questions as the frontier advances.

## Out of scope

- A PWA/TWA replacement for the Android-native client.
- Silently uploading a phone-gallery source or silently falling back to server-side FFmpeg for a local export.
- Merging or deploying PR #33 as part of this effort.
