# 01 — Android local render slice

## Status

Implementation is ready for an open PR on `feat/android-native-full-parity`; the PR must remain unmerged pending review and device verification.

## Delivered in this slice

- [x] Expo/React Native Android project with Clerk native sign-in UI and secure token cache.
- [x] Authenticated FastAPI create/list/detail workflow for YouTube + AI Jobs.
- [x] AndroidX Media3 local trim + fixed 9:16 center crop, progress and cancel.
- [x] Gallery save and system share sheet for the 720 × 1280 H.264/AAC MP4.
- [x] Setup guidance and `.env.example` with public Clerk publishable key and API origin placeholders.
- [x] TypeScript check passes.
- [x] Android prebuild and Expo-module autolinking resolve.
- [x] Android JavaScript bundle/export passes with dummy public configuration.

## Still to verify

- [ ] Enable Clerk Native API, then test native sign-in and a FastAPI request with the real Clerk instance; confirm its authorized party is covered by the server's explicit `CLERK_AUTHORIZED_PARTIES` allowlist.
- [ ] Build/install the native APK, export and play a clip, verify gallery/share permissions, cancellation, and performance on an Android device or emulator.

## Follow-up tickets / parity gaps

- Candidate-to-editor flow and downloaded Job media handoff.
- Multi-track timeline, segment tools, text/caption correction and caption styles.
- Hook, logo, overlay, transition, template and branding workflows.
- Face tracking, aspect/layout choices, crop gestures, keyframes and effects.
- Audio/music/narration and mix tools.
- Local project persistence, source upload, export configuration and performance testing.

## Notes

The local gallery-video render does not upload the selected source to FastAPI. The Job workflow still keeps its YouTube download, transcription, analysis, and Job data on FastAPI. The current native render does not consume the server-side FFmpeg render plan. Clerk's native components are beta; this branch has no live Clerk key, Android SDK or emulator, so those items are intentionally not marked verified.

## Dependency audit note

`npm audit --omit=dev` reported seven moderate alerts propagated from two Expo build-tool advisories: `glob@13.0.6` (GHSA-3g3m-2fjr-6pw4) and `minimatch@10.2.6` (GHSA-g3hv-75wg-m249), nested under `@expo/cli` / `@expo/fingerprint`. The current Expo ranges do not accept the patched major versions; npm's suggested remediation is a semver-major downgrade of Clerk/Expo to 3.7.8, so no downgrade or unverified override was applied. Recheck when Expo ships a compatible upstream update. These Node CLI dependencies are not part of the exported application JavaScript bundle.
