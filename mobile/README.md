# AI Clipper Carbon — Android

This is the first native Android slice, not complete feature parity with the existing web editor. It adds a Clerk-authenticated Expo app, the existing YouTube/AI job workflow, and a basic on-device video trim + portrait crop path.

## Configure and build

```sh
cd mobile
npm ci
cp .env.example .env.local
# Edit .env.local with the two public configuration values below.
npm run typecheck
npm run android
```

| Variable                            | Value                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key for the native app. Never use a Clerk secret key in the client. |
| `EXPO_PUBLIC_API_BASE_URL`          | HTTPS FastAPI origin, for example `https://api.example.com`; do not append `/api`.    |

Use a reachable HTTPS API host when testing on a physical phone; `localhost` on a phone points to the phone itself. The client sends Clerk Bearer tokens to FastAPI. `EXPO_PUBLIC_*` values are included in the app bundle, so set production values in the Android/EAS build environment and keep `.env.local` out of Git.

## Clerk Dashboard setup

Complete these steps before attempting sign-in; see Clerk's [Expo quickstart](https://clerk.com/docs/expo/getting-started/quickstart) and [production deployment guide](https://clerk.com/docs/guides/development/deployment/expo) for the current UI:

1. In **Native applications**, enable **Native API**. Clerk warns that this opens a public request pathway that bypasses browser-based CAPTCHA challenges, so review the instance's abuse protections before enabling it.
2. Add the Android app to **Native applications**. Set both the Android namespace and package name to `id.web.sistems.aiclipcarbon` (the `android.package` value in `app.json`).
3. For social/enterprise SSO, add `aiclipcarbon://sso-callback` under **Allowlist for mobile SSO redirect**. The app's `scheme` is `aiclipcarbon`; Expo's native `useSSO()` default callback path is `sso-callback`. If the configured Clerk flow produces a different callback, allowlist that exact callback instead.
4. In **API keys**, copy the instance's publishable key into `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `mobile/.env.local`. Never put a Clerk secret key in the app. Enable the sign-in methods and provider credentials that the app should offer; `AuthView` displays the enabled methods.
5. On the FastAPI deployment, keep `CLERK_AUTHORIZED_PARTIES` explicit. Verify the authorized-party value from a real native sign-in/API request, then add only that exact value to the server allowlist. Do not disable or wildcard the allowlist.

**Verification status:** native sign-in → FastAPI and device rendering have not been end-to-end tested in this branch. The native Clerk `AuthView` is currently beta; testing requires the dashboard setup above, real public app configuration, and an Android development build/device.

A development build is required: Expo Go does not include Clerk's native `AuthView` or this repository's Kotlin Media3 module. `npm run android` creates the ignored `android/` project when needed, builds the app, and installs it on an attached Android device/emulator. Use `npm run start` for JavaScript-only iteration; rebuild with `npm run android` after changing Kotlin or native dependencies.

## Current functionality

Sign in with Clerk and create/list/open the existing YouTube + AI Jobs. FastAPI continues to own YouTube download, transcription, AI analysis and Job state. Separately, choose one video from the Android gallery, set start/end times, trim it and center-crop to 9:16 with AndroidX Media3 Transformer. The 720 × 1280 MP4 (H.264/AAC) export supports progress, cancellation, gallery save and Android sharing. The selected source is processed on the phone and is not uploaded to FastAPI.

The native local-render screen also supports manually entered timed Caption Cues, a text hook for the first three seconds, and a text watermark over the full output. Cue times are relative to the trimmed output. The app represents each Cue and its per-word highlight intervals explicitly, but because this mode does not use a transcript, it estimates equal word intervals across each cue. It is a **local-caption subset**, not AI-generated captions, transcript correction, or Candidate editing. Caption highlights are burned into the exported MP4 through Media3; the pre-export player does not yet show time-synced highlights. Text is fitted to a supported safe area and export must reject text that still overflows rather than silently truncate it; this native check remains unverified on a device. A local overlay export still keeps the selected gallery video on-device.

## What is still missing for full parity

**Next explicit gap: connect AI Candidate review and its transcript/Words/Preview Plan to the native editor and render input**, preserving Candidate Revision behavior. The current manual local caption mode does not provide that integration. Other gaps include editable projects and downloaded Job media; local-master upload; a multi-clip timeline and segment editing; transcript/word correction, caption presets and animation; logos, image/text layers, intro/outro and other branding parity; layout choices and face/speaker tracking; audio, narration, mixing, fades and effects; transitions, templates, reusable styles, channel/profile settings, transform gestures and keyframes; persistent project management; and export quality/format controls. The native renderer only handles one gallery video with a basic trim, fixed center crop, and the documented manual text-overlay subset; it does not reproduce the existing FFmpeg render plan. These follow-ups are recorded in `.scratch/android-native-full-parity/`.

A native Gradle build, device render, playback, permission and performance QA still need to be run on Android. This implementation environment has no Android SDK or emulator, so the PR must not describe native runtime rendering as device-tested.
