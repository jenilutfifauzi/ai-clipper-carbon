# 06 — Native Render Plan contract and capability gates

Type: grilling
Status: open
Blocked by: 02

## Question

What is the contract between the server's `Render Plan`/`Preview Plan` and the AndroidX Media3 renderer? Decide which plan data the app receives, whether native code translates shared plan events or re-plans edits locally, how the 1080×1920 Canvas/reference coordinates map to the 720×1280 export, and which unsupported plan features must block export rather than be silently dropped or sent to a server renderer.

Cover clipping offsets and timeline time, frame rate, per-word caption highlights, hook duration/animation, Watermark/logo assets, effects and transitions, and deterministic parity tests. Keep the phone-gallery source on-device. The current Canvas overlay is a manual local subset, not a full-plan adapter.
