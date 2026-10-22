"""The person model (GLOSSARY.md, Matte; docs/adr/0015): Robust Video Matting's MobileNetV3, which makes a
subject's Matte, downloaded on first use into `DATA_DIR/models` and never bundled.

It is RVM's `rvm_mobilenetv3_fp32.onnx` from its upstream v1.0.0 release, its URL, size and SHA-256
pinned here (PERSON_MODEL_URL), fetched as every downloaded model is (app/model_download.py): the checked
`.part` is renamed into place. Its state carries its name and licence for the Inspector and MCP, since
its weights are GPL-3.0.
"""

import os
from pathlib import Path

import httpx

from app.model_download import ModelBusy, ModelDownload, ModelSource

PERSON_MODEL_FILE = "rvm_mobilenetv3_fp32.onnx"
PERSON_MODEL_URL = f"https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/{PERSON_MODEL_FILE}"
PERSON_MODEL_SHA256 = "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828"
PERSON_MODEL_BYTES = 14_975_696
PERSON_MODEL_NAME = "Person model"
PERSON_MODEL_LICENCE = "GPL-3.0"
PINNED = ModelSource(PERSON_MODEL_URL, PERSON_MODEL_SHA256, PERSON_MODEL_BYTES)


class PersonModelBusy(ModelBusy):
    """The person model is being downloaded, or a cancelled download is still stopping: it can't be
    removed, nor downloaded again, meanwhile."""


class PersonModel(ModelDownload):
    """The person model in `models_dir` (its file, PERSON_MODEL_FILE), fetched from `source`."""

    name = "The person model"
    busy = PersonModelBusy

    def __init__(self, models_dir: Path, source: ModelSource = PINNED, http_client: httpx.Client | None = None) -> None:
        self.path = models_dir / PERSON_MODEL_FILE
        super().__init__(models_dir, source, models_dir / f"{PERSON_MODEL_FILE}.part", http_client)

    @property
    def installed(self) -> bool:
        return self.path.is_file()

    def state(self) -> dict:
        """ModelDownload's state, with the model's `name` and `licence`."""
        return super().state() | {"name": PERSON_MODEL_NAME, "licence": PERSON_MODEL_LICENCE}

    def _install(self) -> None:
        os.replace(self.part, self.path)

    def _delete(self) -> None:
        self.path.unlink(missing_ok=True)
