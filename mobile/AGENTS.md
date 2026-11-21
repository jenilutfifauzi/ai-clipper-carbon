This is the Android-only Expo/React Native client for AI Clipper Carbon (Expo SDK 58).

## Expo and native APIs

Before changing Expo or React Native APIs, check `mobile/package.json` and use the versioned SDK docs (`https://docs.expo.dev/versions/v58.0.0/`) or the SDK 58 documentation index. Use `npx expo install` for Expo packages so the installed versions match the SDK.

The native project is generated from `app.json` and local modules; `android/` is ignored and must not be hand-edited. The Android-only Media3 module lives in `modules/on-device-renderer/`. Changes to its Kotlin code or native dependencies require a development-build rebuild; Expo Go cannot run this app.

## App conventions

- Use Expo Router routes in `src/app/`; keep shared API and feature logic outside that directory.
- Keep Clerk secret keys and AI provider secrets on the server. Only public client configuration may use `EXPO_PUBLIC_*` variables.
- The phone-gallery trim/crop workflow must stay local: do not upload its selected source as part of rendering.
- Do not claim Android runtime, render, or performance behavior is verified without a real Android build/device or emulator check.

## Checks

Run `npm run typecheck`, `npm run test:unit`, `npm run android:prebuild`, and `npm run android:export`. Run `npm run android` on a connected Android device/emulator for native validation when the Android SDK is available.
