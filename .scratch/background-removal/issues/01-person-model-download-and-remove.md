# 01: Person model, download and remove

**Parent spec:** `../spec.md` ("Model download", "Editor", "MCP"); ADR 0015, following ADR 0019's Kokoro pattern.

**What to build:** the owner opens the "Remove background" section of the Inspector on a Segment or an Overlay and sees the person model's state. If it is absent, they click "Download person model (15 MB, GPL-3.0)" and watch its progress, can Cancel it (it resumes later from where it stopped), and can Remove it once it is ready. The agent can do the same through MCP. The section shows only the model's state in this ticket; its switch and feather come in 02.

**The model:** RVM MobileNetV3 (`rvm_mobilenetv3_fp32.onnx`) from its upstream release, with a pinned URL, SHA-256 and byte size, stored in `DATA_DIR/models`. It carries its name, size and licence ("GPL-3.0") for the UI and MCP.

**Downloads:** one at a time, in its own thread, to a `.part` file resumed with an HTTP Range request. It is renamed into place only after the digest check. Its states are absent, downloading (done/total), ready, and failed (with a message).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Endpoints mirror Kokoro's: read the state, start the download (202), cancel it (keeping the `.part`), and remove the model.
- [x] A wrong digest installs nothing and leaves the state failed with a message; a retry downloads again.
- [x] A cancelled download resumes from its `.part`.
- [x] Remove deletes the file and returns to absent. (Refusing removal while a Matte is being made, and removing every Matte, come in 08.)
- [x] The Inspector section shows Download with the licence, progress with Cancel, Ready with Remove, and Failed with Retry, on a desktop and in the phone's sheet.
- [x] MCP has a tool that starts the download and reports the model's state.
- [x] Tests follow `test_kokoro_download.py` (a local HTTP server): resume, digest refusal, cancel and remove. Run only this feature's test files.

## Comments

**Built:**
- `backend/app/model_download.py`: the download machinery Kokoro had, generalised (`ModelSource`, `ModelDownload`, `ModelBusy`, `Refused`, `MODELS_DIR`): `.part` with Range resume, digest check, cancel keeping the `.part`, one download at a time, states absent/downloading/ready/failed. A subclass gives `name`, `busy`, `installed`, `_install`, `_delete` and optionally `_cleanup`. `KokoroModel` is now a subclass (its unpack through staging and its engine unchanged); `KokoroSource` is an alias of `ModelSource`.
- `backend/app/person_model.py`: `PersonModel` for RVM's `rvm_mobilenetv3_fp32.onnx` (v1.0.0 release), pinned SHA-256 `88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828`, 14,975,696 bytes, measured from the upstream file. Installed by renaming the checked `.part` to `DATA_DIR/models/rvm_mobilenetv3_fp32.onnx` (`PersonModel.path`). Its state adds `name` ("Person model") and `licence` ("GPL-3.0").
- `Ports.person_model` (real ports create it; `app.state.person_model`). Routes: `GET /api/models/person`, `POST /api/models/person/download` (202; 409 while a cancelled one is still stopping), `DELETE /api/models/person/download` (cancel, 204), `DELETE /api/models/person` (remove, 204; 409 while downloading). 404 when not offered.
- MCP `download_person_model(timeout_secs=120)`: starts the download and polls it with `ctx.report_progress`, returning the state (ready, failed with message, or downloading on timeout: call again). `TOOLS_BUDGET_BYTES` raised to 89,000 (88,615 with it).
- Frontend: `api.personModel/downloadPersonModel/cancelPersonModelDownload/removePersonModel`, `PersonModelSource` (`personModel.ts`, polling as Kokoro's VoicesSource), and `RemoveBackgroundFields.tsx` ("Remove background" Group: Download person model (15 MB, GPL-3.0), progress with Cancel, Ready with Remove, Failed with its message and Retry). It shows on a picked Segment and Overlay (before the Color section) and on a mixed Pick of Segments and Overlays; the phone's sheet renders the same Inspector.
- Tests: `backend/tests/test_person_model_download.py` (resume, digest refusal then retry, cancel and resume, busy, remove, API, MCP); the local server moved to `backend/tests/model_server.py`, shared with `test_kokoro_download.py`. `frontend/src/pages/job/advanced/personModel.test.tsx`.

**Deviations:** remove is refused only while downloading here; refusing it while a Matte is being made and removing every Matte come in 08 (wrap `remove_person_model` in the Matte runner's idle check, as Kokoro's route does with `narrations.idle`).

