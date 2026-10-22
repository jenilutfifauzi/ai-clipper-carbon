# 01: Person model, download and remove

**Parent spec:** `../spec.md` ("Model download", "Editor", "MCP"); ADR 0015, following ADR 0019's Kokoro pattern.

**What to build:** the owner opens the "Remove background" section of the Inspector on a Segment or an Overlay and sees the person model's state. If it is absent, they click "Download person model (15 MB, GPL-3.0)" and watch its progress, can Cancel it (it resumes later from where it stopped), and can Remove it once it is ready. The agent can do the same through MCP. The section shows only the model's state in this ticket; its switch and feather come in 02.

**The model:** RVM MobileNetV3 (`rvm_mobilenetv3_fp32.onnx`) from its upstream release, with a pinned URL, SHA-256 and byte size, stored in `DATA_DIR/models`. It carries its name, size and licence ("GPL-3.0") for the UI and MCP.

**Downloads:** one at a time, in its own thread, to a `.part` file resumed with an HTTP Range request. It is renamed into place only after the digest check. Its states are absent, downloading (done/total), ready, and failed (with a message).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Endpoints mirror Kokoro's: read the state, start the download (202), cancel it (keeping the `.part`), and remove the model.
- [ ] A wrong digest installs nothing and leaves the state failed with a message; a retry downloads again.
- [ ] A cancelled download resumes from its `.part`.
- [ ] Remove deletes the file and returns to absent. (Refusing removal while a Matte is being made, and removing every Matte, come in 08.)
- [ ] The Inspector section shows Download with the licence, progress with Cancel, Ready with Remove, and Failed with Retry, on a desktop and in the phone's sheet.
- [ ] MCP has a tool that starts the download and reports the model's state.
- [ ] Tests follow `test_kokoro_download.py` (a local HTTP server): resume, digest refusal, cancel and remove. Run only this feature's test files.
