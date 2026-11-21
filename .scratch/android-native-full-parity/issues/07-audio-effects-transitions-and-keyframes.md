# 07 — Audio, effects, transitions, transforms, and keyframes

Type: grilling
Status: open
Blocked by: 02, 06

## Question

Which advanced editing operations must be executed locally on Android, and what is the acceptable capability boundary for Media3? Decide the required ordering and fidelity for source/segment/music/narration audio, volume and keyframes, fades, ducking, mute/detach, audio/video effects, transitions, crop/transform/face tracking, and freeze/reverse/speed.

For any operation not yet supported on the phone, decide whether the user may edit but not export, must receive a clearly labeled approximation, or should be prevented from using that operation in a native project. Include a safe device-performance budget for real-time preview versus final local export; do not rely on a silent backend render fallback.
