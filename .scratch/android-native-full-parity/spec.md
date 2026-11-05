# Android native editor parity

## Goal

Bring the current AI Clipper Carbon workflow to an Android-first, CapCut-like native mobile experience, while keeping editing and final rendering on the phone where practical. The target remains full user-facing feature parity; a single PR may deliver a verified vertical slice and must not claim the remaining editor features are complete.

## Decisions

- Build the native client with Expo/React Native and Android-specific Kotlin modules.
- Use Clerk native authentication; keep the Clerk secret key off-device.
- Retain FastAPI for the existing YouTube download, transcription/Whisper, AI analysis and Job workflow. The native app calls it with a Clerk Bearer token.
- Process a user-selected phone video locally for the first render slice. Do not upload that source to FastAPI for this render.
- Use AndroidX Media3 Transformer for a single clip's time trim and 9:16 center crop. The first output preset is a lightweight 720 × 1280 MP4 with H.264/AAC.
- The local overlay mode accepts manually timed Captions only; it does not consume AI Candidate, transcript, or server Preview Plan data.
- Preserve existing data and leave the requested pull request open; do not merge or deploy it.

## First implementation slice

- Expo Android app with native Clerk sign-in and secure token storage.
- FastAPI job list/create/detail screens for the existing YouTube + AI workflow.
- Native local video picker, trim range, 9:16 center crop, progress/cancel, gallery save and share.
- Clear setup guidance and explicit tracking of features that still lack native parity.

## Current local caption/branding slice

- Manually entered Caption Cues are timed relative to the start of the trimmed output, checked for bounds and overlap, then represented as a Cue and explicitly timed `CaptionWord` events. Because this screen has no transcript, word timing is evenly estimated across each cue; it is not speech recognition or transcript timing.
- The hook is burned for the first three seconds; a text watermark is burned for the full output. Captions, hook and watermark are drawn by an AndroidX Media3 CanvasOverlay in the local 720 × 1280 export. A non-empty local overlay never uploads the selected source.
- Native layout shrinks text to the supported minimum size, then rejects export if a cue, hook, or watermark still cannot fit; it must not silently truncate words. This fail-closed behavior is not device-verified.
- The pre-export player does not yet render time-synced caption highlights. Logo files, richer Candidate styling, and the full server Render Plan are not supported by this slice.
- **Next explicit parity gap:** connect AI Candidate review and its transcript/Words/Preview Plan to the native editor and render input, preserving Candidate Revision semantics. Do not describe the local caption subset as AI Candidate or transcript parity.

## Remaining native parity

- Connect AI Candidate review to native editable projects and downloaded Job media.
- Local master upload and persistent projects/library.
- Multi-clip timeline, segment splitting/reordering, source and scene editing.
- Transcript review, word-level correction, caption presets/position/animation and burned captions.
- Hook and title overlays, logos, intro/outro, image/text layers and post-copy workflow.
- Aspect/layout modes, face/speaker tracking, crop/transform gestures and keyframes.
- Audio tracks, music/narration, mixing, fades, ducking, mute and audio effects.
- Transitions, reusable templates/style presets, channel/profile/settings.
- Full render-plan parity, export format/resolution/quality controls and performance/device testing.

## Acceptance for this PR slice

- `npm run typecheck` succeeds.
- `npm run test:unit` passes the local overlay-plan bounds, sorting, overlap and per-word timing tests.
- Expo Android prebuild discovers the local Kotlin module and configured native plugins.
- Android JS bundle/export succeeds.
- Native runtime/device render is marked unverified if no Android SDK/emulator is available; do not describe it as device-tested.
