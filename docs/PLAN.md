# AI Clipper — clone ringan dari openshorts (fitur clipper dulu)

## Context
Anda ingin clone dari `mutonby/openshorts`, tapi hanya inti **clipper**:
1. masukkan podcast panjang (URL YouTube);
2. AI memilih momen viral;
3. Anda me-review kandidat;
4. clip yang disetujui dipotong, di-reframe ke 9:16 dengan tracking wajah lokal, diberi caption, lalu bisa di-download.

Direktori `/Users/indobuzz/Developer/ai-clipper` masih kosong.

Fitur openshorts yang **sengaja dilewati**:
- posting ke sosmed, dubbing ElevenLabs, thumbnail studio, AI effects, billing/cloud, MCP;
- Remotion render-service;
- folder `cloud/` (memakai lisensi komersial terpisah). Prompt di `gemini_worker.py` berlisensi MIT, jadi boleh diadaptasi asal notice-nya disertakan.

Stack yang dipakai lebih ringan:
- **tanpa torch/YOLO/TransNetV2** (`mlx-whisper` menarik torch, tapi torch tidak dipakai saat transkripsi, jadi dikecualikan);
- subtitle di-burn langsung dengan ffmpeg/libass.

Kondisi mesin (dicek 2026-10-13):
- **Apple M1, RAM 8 GB**, 8 core, sisa disk ±46 GB, macOS 15.7.
- Python 3.12/3.13 (Homebrew), `uv`, Node 22. colima ada tapi tidak dipakai.
- ffmpeg dan deno belum terpasang.
- Swap sudah terpakai ±5 GB saat Chrome dan VS Code terbuka.
- Uji mlx-whisper `large-v3-turbo` di mesin ini: **±1,9× realtime**, memori puncak **2,15 GB**, word timestamps berfungsi. Satu uji audio 5,5 menit macet lebih dari 10 menit, jadi watchdog wajib ada.

## Keputusan (hasil sesi grilling 2026-10-13)
| Topik | Keputusan |
|---|---|
| Pemakai & runtime | Hanya Anda, **native macOS**, tanpa auth. **1 job per waktu**, tahap berjalan berurutan (hemat RAM). Docker tidak masuk v1. |
| Konten | Podcast Indonesia (kadang campur Inggris), 30 menit–3 jam. Episode final hasil edit yang berganti close-up/shot lebar. Bahasa default `id`, bisa di-override per job. |
| Prioritas #1 | **Kualitas pilihan clip**, lalu reframe. Polesan UI belakangan. |
| Alur | **Dua tahap**: analisis → review kandidat (pilih, geser batas, tambah manual, edit hook, override layout) → render hanya clip yang disetujui. |
| Input | **URL YouTube dulu** (video ≤1080p, H.264 diutamakan) + caption otomatis. Clip biasanya dibuat *setelah* episode tayang. Upload master via browser menyusul di M5. |
| Transkrip | **Caption otomatis YouTube** (`id`, json3, ada timing per kata) untuk seleksi dan review. **mlx-whisper turbo hanya untuk clip terpilih**, demi caption burn yang akurat. Kalau caption YouTube tidak ada atau sumbernya upload, seluruh episode ditranskripsi turbo di background. |
| LLM | Gemini **3.8 Flash**, **free tier**. Data dipakai Google dan sudah diterima. Alur **hybrid**: Score per window → Detail dengan transkrip lengkap. |
| Selera | **Profil channel** global + **brief opsional per job**. Clip lama dari episode non-eval dijadikan contoh few-shot. |
| Durasi & jumlah | Clip **20–90 detik**. Kandidat ±1 per 8–10 menit video (60 menit → 6–8, 3 jam → 15–20). |
| Evaluasi | Set referensi dari Anda (clip lama + timestamp). Gerbang M2: **recall ≥60%** dan **≥3 dari top-5 layak posting**. Kalau gagal setelah ±5 iterasi: tambah sinyal audio, uji ulang. Kalau masih gagal, lanjut dengan versi terbaik dan dicatat. |
| Layout 9:16 | **Ikuti scene**: 1 wajah → TRACK, 2 wajah → **SPLIT atas-bawah**, ≥3 atau tanpa wajah → BLUR. Ada override per clip di review. |
| Caption | UPPERCASE, outline hitam, kata aktif oranye `#FF9F0A`, **Montserrat ExtraBold** (OFL; lisensi SF Pro tidak mengizinkan dipakai di video). |
| Hook | Di-burn **3 detik pertama** di bagian atas. Teksnya bisa diedit di review. |
| Penyimpanan | File disimpan sampai job dihapus. UI menampilkan pemakaian disk dan memberi peringatan kalau sisa < 10 GB. |

**Ditunda (setelah v1):**
- Docker;
- editor caption dan crop manual;
- deteksi pembicara aktif (gerak mulut);
- preset caption;
- download di atas 1080p;
- cookie / PO-token provider untuk yt-dlp;
- Gemini paid tier.

## Arsitektur
```
ai-clipper/
  backend/                 FastAPI + pipeline (Python 3.12, uv)
    app/main.py            routes REST + SSE progress + serve frontend build
    app/config.py          env (.env): GEMINI_API_KEY, GEMINI_MODEL, WHISPER_MODEL, FFMPEG_BIN, DATA_DIR, dll.
    app/jobs.py            antrean job 1 worker; state JSON per job di data/jobs/<id>/; artefak per tahap di-cache (resume)
    app/profile.py         profil channel (data/profile.json)
    app/pipeline/
      ingest.py            yt-dlp: video ≤1080p (prefer avc1) + auto-caption id (json3); upload (M5); ffprobe
      transcript.py        parser json3 → words[{start,end,text}] (end disimpulkan dari kata berikutnya)
      asr.py               mlx-whisper turbo: per clip (±2 s padding) dan episode penuh; VAD Silero ONNX; watchdog per chunk
      windows.py           window max(90 s, 1.5×max_secs), overlap 30 s, snap ke batas kata, dedupe overlap
      viral.py             Gemini hybrid Score → Detail (pydantic schema, retry/backoff, profil + brief + few-shot)
      scenes.py            ffmpeg scdet → daftar scene; scene < 1 s digabung ke tetangganya
      tracking.py          FaceDetector MediaPipe Tasks + SpeakerTracker + SmoothCamera
      layout.py            keputusan TRACK / SPLIT / BLUR per scene (+ override per clip)
      captions.py          ASS karaoke + kotak hook 3 detik pertama
      render.py            filter graph per clip (sendcmd crop, vstack untuk split, blur bg, ass) → 1 kali encode
      ffmpeg.py            helper (path ffmpeg-full, h264_videotoolbox, loudnorm)
      run.py               CLI: tahap `analyze` dan `render`, emit progress per tahap
    eval/
      references.yaml      clip referensi Anda: url, start, end, catatan, peran (eval | fewshot)
      run_eval.py          recall (overlap ≥50%) + laporan top-5 untuk dinilai manual
    models/                blaze_face_short_range.tflite, silero_vad.onnx (diunduh script setup)
    assets/fonts/          Montserrat-ExtraBold.ttf (OFL)
    tests/                 unit test (lihat Verifikasi)
  frontend/                Vite + React 18 + TypeScript + Tailwind v4
  Makefile                 setup / dev / eval / update-ytdlp
  .env.example, README.md, THIRD_PARTY_NOTICES.md (MIT openshorts)
```

## Pipeline clipper
### Tahap 1 — analyze (ingest → kandidat)
1. **Ingest (URL)**
   - `yt-dlp[default]` dengan Deno sebagai JS runtime.
   - Video dibatasi ≤1080p, H.264 diutamakan (`-S vcodec:h264`), `merge_output_format=mp4`. File ini langsung bisa dipakai untuk pratinjau di browser, jadi tidak perlu proxy.
   - Caption otomatis diambil dengan `--write-auto-subs --sub-langs id,id-orig --sub-format json3`.
   - Tanpa cookie dan tanpa PO token dulu. Kalau muncul 403, opsi `cookies-from-browser` sudah disiapkan.
2. **Transkrip**
   - Format json3 YouTube sudah memuat `tOffsetMs` per kata (terverifikasi pada podcast Indonesia publik). Teksnya tanpa tanda baca dan sebagian besar huruf kecil.
   - Kalau caption tidak tersedia, seluruh episode ditranskripsi `asr.py` (turbo) di background, dengan progress.
   - Output: `{language, source: youtube|whisper, words[], segments[]}`.
3. **Analisis viral (Gemini, `google-genai`)**
   - **Pass 1, Score**:
     - window dikirim per batch 8, temperature 0.2, skema `ScoreResponse`;
     - memakai aturan "2-second test" dan skor 0–100 yang memakai seluruh rentang;
     - shortlist window ±2× target kandidat.
   - **Pass 2, Detail** (skema `DetailResponse`). Gemini menerima:
     - **transkrip lengkap** dalam format ringkas `[mm:ss] teks`, sehingga paham konteks dan callback serta tidak memilih clip dengan tema yang sama;
     - window shortlist;
     - profil channel, brief job, dan contoh few-shot.

     Isi per kandidat:
     - `start`, `end`, `predicted_score`, `hook_strength`, `emotion`, `retention_notes`, `why`;
     - `viral_hook_text` (≤2 baris, ±40 karakter), `title`;
     - deskripsi TikTok/IG/Shorts dan hashtag dalam bahasa transkrip.
   - Target kandidat: `max(3, round(durasi_menit / 9))`.
   - Prompt diadaptasi dari `SCORE_PROMPT_TEMPLATE` / `DETAIL_PROMPT_TEMPLATE` openshorts. Temperature dituning selama iterasi M2.
   - Post-processing:
     - `snap_clip_to_words` (±1.5 s, lead-in 0.35 s, tail 0.45 s);
     - `dedupe_overlapping`;
     - batas durasi 20–90 s (bisa diubah per job).
   - **Cadangan kalau gerbang M2 gagal**: potongan audio kandidat ikut dikirim di Pass 2 supaya tawa, intonasi, dan energi ikut dinilai.
   - Free tier: retry dengan exponential backoff. Kalau kuota habis, job berstatus "menunggu kuota" dan bisa dilanjutkan.
4. Job berhenti di status **`review`**.

### Review (UI)
- Kandidat ditampilkan urut skor. Pratinjau diputar langsung dari video sumber (range request).
- **Klik kata di transkrip** untuk mengatur start/end (otomatis pas di batas kata). Rentang yang ditandai sendiri bisa dijadikan clip baru.
- Teks hook bisa diedit. Layout bisa di-override per clip: **Auto / Track / Split / Blur**.
- Clip dicentang, lalu render. Render berjalan di antrean background, jadi Anda bisa lanjut me-review.

### Tahap 2 — render (per clip yang disetujui)
1. **ASR per clip**
   - Audio diambil di rentang [start−2 s, end+2 s] dan ditranskripsi mlx-whisper turbo dengan `word_timestamps`, `condition_on_previous_text=False`, `language=id`.
   - Hasilnya jadi words akurat untuk caption burn.
2. **Scene**: filter `scdet` ffmpeg di rentang clip. Scene di bawah 1 s digabung.
3. **Layout per scene** (sampel 5 frame per scene):
   - **1 wajah → TRACK**: crop 9:16 penuh mengikuti wajah.
   - **2 wajah → SPLIT**: dua crop 1080×960 ditumpuk vertikal, wajah kiri di atas. Tiap crop punya SmoothCamera sendiri.
   - **≥3 wajah atau tanpa wajah → BLUR**: shot lebar di tengah dengan background blur.
   - Kalau ada override, layout itu dipakai untuk semua scene.
4. **Caption**: ASS dari words ASR per clip.
   - Maksimal ±16 karakter atau 1.4 s per baris, UPPERCASE, outline hitam, kata aktif `#FF9F0A`, Montserrat ExtraBold (`fontsdir`).
   - Posisi: di **garis tengah** (y≈960) saat SPLIT, di **sepertiga bawah** saat TRACK/BLUR.
   - Zona aman: tidak di atas ±12% tinggi frame, tidak di bawah ±20% terbawah, tidak di sisi kanan ±12%.
   - Caption bisa dimatikan lewat toggle.
5. **Hook**: kotak gelap semi-transparan dengan teks putih Montserrat, tampil di bagian atas (di bawah zona aman) selama 3 detik pertama.
6. **Encode**: 1 proses ffmpeg (crop via `sendcmd`, `vstack`/blur, `ass`), `h264_videotoolbox` (fallback `libx264`), AAC + loudnorm (−14 LUFS), `+faststart`.
7. **Output**: `clip_XX.mp4` (1080×1920) dan `clip_XX.jpg` (poster). Metadata disimpan di `job.json`.

### Tracking wajah "bagus tapi ringan"
- **Analisis**: frame di-decode ffmpeg pada lebar 640 px, deteksi setiap 3 frame dengan MediaPipe Tasks `FaceDetector` (BlazeFace short-range, CPU).
  - MediaPipe 1.1.0 hanya menyediakan Tasks API; `mp.solutions` sudah dihapus.
- **SpeakerTracker** memilih wajah yang diikuti:
  - wajah dicocokkan ke ID jika jarak pusatnya <15% lebar frame;
  - skor tiap ID = luas wajah ditambah decay 0.85;
  - wajah yang sedang diikuti diberi sticky ×3;
  - pergantian target butuh cooldown 30 frame;
  - tracker di-reset setiap scene cut.
- **SmoothCamera**, peningkatan dari "Heavy Tripod" (`SmoothedCameraman`) openshorts:
  - dead-zone 25% lebar crop;
  - lompatan baru diterima setelah terkonfirmasi 3 deteksi berturut-turut;
  - gerakan memakai **critically-damped spring**, jadi pan halus tanpa overshoot;
  - snap langsung ke target di awal scene baru;
  - posisi diinterpolasi di antara frame yang dideteksi.
- **Render**:
  - Hanya *change points* yang ditulis ke file `sendcmd` (`crop@c x/y`). Kalau wajah hilang, posisi crop terakhir dipertahankan.
  - Video yang sudah vertikal di-passthrough.

## API
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/jobs` | `url` (M1–M4) atau multipart `file` (M5), plus opsi: `brief`, `min_secs`, `max_secs`, `captions`, `language` |
| GET | `/api/jobs` · `/api/jobs/{id}` | daftar job dan detail job beserta kandidat/clip-nya |
| GET | `/api/jobs/{id}/events` | SSE: tahap + persen (download, transcript, analyze, review, asr, render, done/error/menunggu kuota) |
| PATCH | `/api/jobs/{id}/candidates/{cid}` | ubah `start`/`end`, `hook_text`, `layout`, `selected` |
| POST | `/api/jobs/{id}/candidates` | tambah clip manual dari rentang transkrip |
| POST | `/api/jobs/{id}/render` | render kandidat yang dipilih |
| DELETE | `/api/jobs/{id}` | hapus job beserta file-nya |
| GET · PUT | `/api/profile` | profil channel (niche, audiens, gaya clip, hal yang dihindari) |
| GET | `/api/system/disk` | pemakaian dan sisa disk |
| GET | `/media/{id}/{file}` | file mp4/jpg (mendukung range request untuk pratinjau) |

## Evaluasi (gerbang M2)
- **`eval/references.yaml`**: Anda mengisi clip lama dari 2–3 episode yang sudah ada di YouTube (url, start, end, catatan).
  - Episode berperan `eval` dipakai untuk mengukur.
  - Episode berperan `fewshot` dipakai sebagai contoh di prompt. Keduanya tidak boleh tumpang-tindih, supaya skor tidak bocor.
- **`make eval`** menjalankan tahap analyze pada episode eval, lalu melaporkan:
  - **recall**: persentase clip referensi yang muncul di daftar kandidat (overlap ≥50%);
  - **laporan top-5**: judul, rentang waktu, dan alasan per kandidat, untuk dinilai manual.
- **Lulus**: recall ≥60% dan ≥3 dari top-5 layak posting.
- **Batas iterasi**: ±5 iterasi prompt. Kalau belum lulus, aktifkan sinyal audio, lalu uji ulang. Kalau masih gagal, lanjut ke M3 dengan versi terbaik dan hasilnya dicatat di README.

## Design system — black / white / orange, glassmorphism ala Apple
- **M3**: UI fungsional sudah memakai token dari `frontend/src/styles/tokens.css`. **M6**: polesan glass penuh.
- **Token** (CSS variables):
  - dark (default): bg `#000`, permukaan glass `rgba(255,255,255,0.06)`;
  - glass: `backdrop-filter: blur(28px) saturate(180%)`, border `rgba(255,255,255,0.12)`, highlight inner-top 1 px;
  - teks `#FFF` / `rgba(255,255,255,0.6)`;
  - aksen oranye `#FF9F0A` (Apple systemOrange), dengan gradient ke `#FF6A00` untuk CTA;
  - light theme: bg `#F5F5F7`, glass putih `rgba(255,255,255,0.7)`, teks `#000`.
- **Visual**:
  - tipografi UI `-apple-system, "SF Pro Display", Inter` (khusus UI lokal; video memakai Montserrat);
  - radius 20–28 px, shadow lembut;
  - blob gradient oranye blur di background agar efek glass terlihat;
  - transisi spring yang halus, dengan dukungan `prefers-reduced-motion`.
- **Komponen**:
  - `GlassPanel`, `GlassButton` (primary oranye / secondary glass), `SegmentedControl`, `Slider`, `Toggle`;
  - `ScoreRing`, `StageProgress`, `DiskMeter`;
  - `CandidateRow`: pratinjau, skor, hook yang bisa diedit, override layout, centang;
  - `TranscriptPicker`: klik kata untuk start/end, tandai rentang untuk clip baru;
  - `ClipCard`: player 9:16, judul, alasan, tombol copy deskripsi, download.
- **Halaman**:
  1. **Home**: input URL (upload menyusul di M5), brief opsional, opsi (rentang durasi, caption on/off), daftar job terakhir, dan meter disk.
  2. **Job**: progress per tahap (SSE), lalu **review kandidat**: daftar kandidat dan transkrip di satu sisi, pratinjau di sisi lain. Setelah render, grid clip diurutkan berdasarkan skor, dengan panel analisis AI per clip.
  3. **Profil**: form profil channel.
- Responsif sampai lebar ponsel.

## Dependensi
- **Backend**: `fastapi`, `uvicorn[standard]`, `python-multipart`, `yt-dlp[default]`, `mlx-whisper`, `onnxruntime` (Silero VAD), `google-genai`, `pydantic`, `mediapipe` (ikut menarik `opencv-contrib-python`), `numpy`, `python-dotenv`, `pyyaml`.
  - Hasil dry-run `uv pip compile` untuk py3.12/arm64: resolve tanpa konflik (numpy 2.5.4, mediapipe 1.1.0, mlx-whisper 0.4.3).
  - **torch dikecualikan** lewat override di `[tool.uv]` (misalnya marker yang tidak pernah cocok). `mlx_whisper` hanya meng-import torch di `torch_whisper.py` (konversi model). `numba` dan `scipy` tetap dibutuhkan untuk word timestamps. Diverifikasi di M0 dengan import + transkripsi uji.
  - Dihapus dari rencana awal: `faster-whisper`, `scenedetect`, `opencv-python-headless` (bentrok `cv2` dengan opencv-contrib milik MediaPipe).
- **Frontend**: `react`, `react-dom`, `react-router`, `tailwindcss` v4, `lucide-react`.
- **Sistem**:
  - `brew install ffmpeg-full deno`. `ffmpeg` biasa dari Homebrew sudah tidak menyertakan libass sejak Januari 2026.
  - `ffmpeg-full` bersifat keg-only, jadi `FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`. Formula ini mencakup libass, fontconfig, freetype, harfbuzz, videotoolbox, dan `scdet`.

## Urutan implementasi
| Milestone | Isi | Selesai bila |
|---|---|---|
| **M0** | Scaffold: `git init`, `pyproject.toml` (uv, Py 3.12, override torch), Makefile, `.env.example`, script unduh model (tflite, silero onnx) dan font, `THIRD_PARTY_NOTICES.md` | `make setup` sukses, `import mlx_whisper` tanpa torch, ffmpeg-full memiliki filter `ass` dan `scdet` |
| **M1** | `ingest.py` (URL), `transcript.py` (json3), `asr.py` (per clip + cadangan episode penuh, VAD, watchdog), CLI `python -m app.pipeline.run analyze <url>` | Transkrip podcast nyata (sumber YouTube dan whisper) tersimpan dan bisa di-resume |
| **M2** | `windows.py`, `viral.py`, profil + brief + few-shot, `eval/` | **Gerbang** evaluasi tercapai (atau prosedur gagal-gerbang sudah dijalankan) |
| **M3** | FastAPI + antrean 1 worker + SSE, UI fungsional: Home, review kandidat (TranscriptPicker, edit hook, override layout), Profil | Alur URL → review berjalan di browser |
| **M4** | `scenes.py`, `tracking.py`, `layout.py`, `captions.py`, `render.py`; antrean render | Clip 1080×1920 dengan layout TRACK/SPLIT/BLUR, caption, dan hook |
| **M5** | Upload master via browser (stream ke disk + progress) → transkripsi turbo penuh di background | Job dari file upload sampai ke tahap review |
| **M6** | Polesan glass penuh, light/dark, responsif, README | Screenshot gelap/terang dan lebar ponsel |

## Verifikasi
- **Unit test** (`uv run pytest`):
  - parser json3 (offset per kata, waktu selesai kata);
  - windows, snap, dedupe;
  - target jumlah kandidat;
  - penggabungan scene < 1 s;
  - keputusan layout (0/1/2/≥3 wajah, override);
  - SmoothCamera (tidak ada lompatan >N px per frame, tidak overshoot);
  - generator ASS (panjang baris, posisi split/tunggal, zona aman, kotak hook).
- **M1**: CLI pada satu podcast Indonesia publik. Caption `id` terunduh, words terurai, dan cadangan turbo berjalan dengan watchdog pada audio 5–10 menit.
- **M2**: `make eval` dengan `references.yaml` dari Anda. Laporan recall dan top-5 disimpan per iterasi prompt.
- **M4**:
  - `ffprobe` memastikan output 1080×1920, durasi 20–90 s, ada audio;
  - pemeriksaan visual dengan `ffmpeg -vf select` pada scene close-up (TRACK), shot lebar 2 orang (SPLIT), dan ≥3 orang (BLUR): wajah tetap di dalam frame, caption dan hook berada di zona aman.
- **UI** (`make dev`, ego-browser): submit URL, progress SSE, review (klik kata, tambah clip, edit hook, override), render, putar, dan download. Screenshot gelap/terang dan lebar ponsel di M6.

## Risiko yang diketahui
- **yt-dlp dan caption YouTube** bisa rusak sewaktu-waktu. Mitigasi: Deno, `make update-ytdlp`, dan cadangan turbo penuh.
- **RAM 8 GB**: sebaiknya tutup Chrome saat transkripsi turbo episode penuh. Tahap job berjalan berurutan, tidak paralel.
- **Kualitas caption YouTube** (tanpa tanda baca, ada salah dengar) bisa menurunkan kualitas seleksi. Dampaknya diukur di gerbang M2.
- **Ketajaman**: close-up dari sumber 1080p terlihat agak lembut karena crop diperbesar ±1,8×. Sudah diterima. Upload master (M5) memberi hasil lebih tajam.
- **Rate limit Gemini free tier** belum terverifikasi angkanya. Mitigasi: backoff dan status "menunggu kuota".
