"""yt-dlp's download progress as one fraction, from the hook calls yt-dlp makes, without the network."""

from app.video_source import DownloadProgress

VIDEO, AUDIO = "source.f299.mp4", "source.f140.m4a"


def downloading(filename: str, done: int, total: int | None, estimate: int | None = None) -> dict:
    return {"status": "downloading", "filename": filename, "downloaded_bytes": done,
            "total_bytes": total, "total_bytes_estimate": estimate}


def test_a_video_and_an_audio_stream_count_as_one_download_and_captions_dont_count():
    reported = []
    progress = DownloadProgress(reported.append)
    # yt-dlp fetches the caption track first, through the same hook, before it chooses to download.
    progress.hook(downloading("source.id-orig.json3", 440, None, estimate=440) | {"status": "finished"})
    progress.run({"requested_formats": [{"filesize": 900}, {"filesize_approx": 100}]})

    progress.hook(downloading(VIDEO, 450, 900))
    progress.hook(downloading(VIDEO, 900, 900) | {"status": "finished"})
    progress.hook(downloading(AUDIO, 50, 100))
    progress.hook(downloading(AUDIO, 100, 100) | {"status": "finished"})

    assert reported == [0.45, 0.9, 0.95, 1.0]


def test_without_known_sizes_it_goes_by_what_each_download_reports():
    reported = []
    progress = DownloadProgress(reported.append)
    progress.run({"format_id": "18"})

    progress.hook(downloading(VIDEO, 0, None))
    progress.hook(downloading(VIDEO, 30, None, estimate=120))
    progress.hook({"status": "error", "filename": VIDEO})

    assert reported == [0.25]


def test_a_format_already_on_disk_counts_as_downloaded():
    reported = []
    progress = DownloadProgress(reported.append)
    progress.run({"requested_formats": [{"filesize": 900}, {"filesize": 100}]})

    # What yt-dlp reports for a file it finds complete: no downloaded_bytes.
    progress.hook({"status": "finished", "filename": VIDEO, "total_bytes": 900})
    progress.hook(downloading(AUDIO, 50, 100))

    assert reported == [0.9, 0.95]
