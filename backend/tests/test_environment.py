"""The environment stays free of torch and the packages the spec dropped."""

import sys
from importlib import metadata
from importlib.util import find_spec

import pytest


# faster-whisper is Linux's Whisper (app/whisper_worker.py), so only the Mac does without it.
NOT_INSTALLED = ["torch", "scenedetect", *(["faster-whisper"] if sys.platform == "darwin" else [])]


@pytest.mark.parametrize("name", NOT_INSTALLED)
def test_package_is_not_installed(name):
    with pytest.raises(metadata.PackageNotFoundError):
        metadata.distribution(name)


def test_only_opencv_is_the_one_mediapipe_brings():
    installed = {dist.metadata["Name"].lower() for dist in metadata.distributions()}

    assert {name for name in installed if name.startswith("opencv")} == {"opencv-contrib-python"}


@pytest.mark.skipif(sys.platform != "darwin", reason="mlx-whisper is the Mac's")
def test_mlx_whisper_imports_without_torch():
    import mlx_whisper

    assert callable(mlx_whisper.transcribe)
    assert find_spec("torch") is None


@pytest.mark.skipif(sys.platform != "linux", reason="faster-whisper is Linux's")
def test_faster_whisper_imports_without_torch():
    import faster_whisper

    assert faster_whisper.WhisperModel
    assert find_spec("torch") is None
