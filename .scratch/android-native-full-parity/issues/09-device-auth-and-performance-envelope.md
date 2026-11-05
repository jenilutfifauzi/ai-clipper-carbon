# 09 — Device support, Clerk auth, and performance acceptance

Type: grilling
Status: open

## Question

What Android OS/device floor and measurable acceptance envelope should the native editor target? Decide which device classes and source formats/resolutions the first supported release must handle, acceptable local-render time, memory/thermal behavior, cancel/restart recovery, gallery permissions, and minimum offline behavior.

Separately confirm the exact Clerk Native API authorized-party value(s) for the production instance and required sign-in methods. Native sign-in → FastAPI and Media3 exports remain unverified until a configured Clerk instance and Android device/emulator are tested; setup guidance alone is not proof of runtime parity. Define the evidence required before calling those paths verified.
