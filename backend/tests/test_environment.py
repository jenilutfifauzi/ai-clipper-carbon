"""The environment stays free of torch and the packages the spec dropped."""

from importlib import metadata
from importlib.util import find_spec

import pytest


@pytest.mark.parametrize("name", ["torch", "faster-whisper", "scenedetect"])
def test_package_is_not_installed(name):
    with pytest.raises(metadata.PackageNotFoundError):
        metadata.distribution(name)


def test_only_opencv_is_the_one_mediapipe_brings():
    installed = {dist.metadata["Name"].lower() for dist in metadata.distributions()}

    assert {name for name in installed if name.startswith("opencv")} == {"opencv-contrib-python"}


def test_mlx_whisper_imports_without_torch():
    import mlx_whisper

    assert callable(mlx_whisper.transcribe)
    assert find_spec("torch") is None
