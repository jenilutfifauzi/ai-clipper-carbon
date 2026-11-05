# Android native editor parity

## Goal

Bring the current AI Clipper Carbon workflow to an Android-first, CapCut-like native mobile experience, while keeping editing and final rendering on the phone where practical. The target remains full user-facing feature parity; a single PR may deliver a verified vertical slice and must not claim the remaining editor features are complete.

## Decisions

- Build the native client with Expo/React Native and Android-specific Kotlin modules.
- Use Clerk native authentication; keep the Clerk secret key off-device.
- Retain FastAPI for the existing YouTube download, transcription/Whisper, AI analysis and Job workflow. The native app calls it with a Clerk Bearer token.
- Process a user-selected phone video locally for the first render slice. Do not upload that source to FastAPI for this render.
- Use AndroidX Media3 Transformer for a single clip's time trim and 9:16 center crop. The first output preset is a lightweight 720 × 1280 MP4 with H.264/AAC.
- Preserve existing data and leave the requested pull request open; do not merge or deploy it.

## First implementation slice

- Expo Android app with native Clerk sign-in and secure token storage.
- FastAPI job list/create/detail screens for the existing YouTube + AI workflow.
- Native local video picker, trim range, 9:16 center crop, progress/cancel, gallery save and share.
- Clear setup guidance and explicit tracking of features that still lack native parity.

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
- Expo Android prebuild discovers the local Kotlin module and configured native plugins.
- Android JS bundle/export succeeds.
- Native runtime/device render is marked unverified if no Android SDK/emulator is available; do not describe it as device-tested.
