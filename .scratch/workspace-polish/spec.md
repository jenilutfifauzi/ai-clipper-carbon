# Workspace polish: Advanced Edit dirapikan ala Concat

Status: ready-for-agent
Created: 2026-10-23
Reference: screenshot Concat (layout desktop) dari user; `docs/referensi/concat` di main checkout.

## Context
Layout Advanced Edit sudah lengkap fiturnya (ADR 0024: grid 3 kolom resizable + bottom tabs + Meters), tapi terasa padat dan tidak rapi dibanding referensi Concat: panel "glass", top bar penuh ikon, transport preview berupa slider, inspector field bertumpuk, toolbar timeline tanpa grup. Tujuan: susunan visual ala Concat **tanpa** mengganti identitas (aksen oranye + token tema tetap) dan tanpa dependency UI baru (ADR 0024). Keputusan diambil lewat grilling (mattpocock `grilling`).

## Keputusan (hasil grilling)
- Cakupan: desktop + HP.
- Gaya: token tetap; panel atas-level jadi **flat solid** (`--surface` + border tipis, tanpa backdrop blur) menggantikan `glass` di Assets/Inspector/Timeline aside.
- Top bar: tanpa menu File/Edit/View. Kiri Back; **judul + SaveStatus di tengah**; kanan aksi dikelompokkan (layout toggles | Downloads, Save Frame, History, Save Template) lalu Export. Undo/Redo **keluar** dari top bar.
- Panel kiri: strip tab **ikon + label kecil di bawah**, tab aktif berlatar. **Media + Audio digabung** jadi satu tab Media dengan sub-nav kategori (All / Video / Audio / Images). Sub-nav kolom kiri hanya untuk tab yang datanya sudah berkategori.
- Preview: header panel ("Preview" | "1080×1920 · 30 fps" | AspectPicker). Transport ala Concat: kotak timecode kiri (`t / durasi`), tengah ke-awal · step mundur · play · step maju · ke-akhir, kanan Compare/Hold/Take/RateMenu/Loop/fullscreen. **Slider posisi dihapus** (desktop & HP).
- Inspector: baris **label kiri, kontrol kanan**; grup collapsible dengan chevron; status lipat **diingat browser per nama grup** (store workspaceLayout). Hanya di Advanced Edit (varian lewat konteks), Clip editor tidak berubah. Tanpa tab baru.
- Timeline toolbar, grup dipisah garis tipis: Undo/Redo | Split, Freeze, Duplicate, Copy, Paste, Delete | Magnet, Skim | Tambah Teks (T), Tambah Audio (speaker) → membuka tab Text/Media(Audio) di panel kiri | Zoom −/+/fit (kanan).
- Meters tetap di kanan area bawah, ikut gaya flat.
- HP: struktur tetap (preview, timeline, Toolbar, Sheet); dapat transport baru yang sama dan panel flat.

## Langkah kerja
0. Tulis `.scratch/workspace-polish/spec.md` (Status: ready-for-agent) + tiket `issues/01..07` sesuai bagian di bawah; tambah entri GLOSSARY bila ada istilah baru (Transport, Preview header); catat ADR kecil `0025-workspace-polish-flat-panels.md` (flat vs glass, merge Media+Audio). Kerjakan di worktree dari origin/main.
1. **Flat panels** — util `panel` baru di `frontend/src/index.css` (dekat `glass` :38) ; ganti `glass` di `AdvancedEdit.tsx` :1777/:1836/:1845 dan `Meters.tsx:61`. Popover/sheet tetap `glass`.
2. **Top bar** — `TopBar` di `advanced/Chrome.tsx:105`: grid 3 kolom (kiri back, tengah judul/status, kanan aksi); hapus undo/redo (prop `history` dipindah ke timeline). Urutan aksi di `AdvancedEdit.tsx:1668-1702`, beri pemisah antar grup. Update `exportButton.test.tsx`.
3. **Asset tabs** — `AssetTabs`/`ASSET_TABS` (`Chrome.tsx:58-104`): ikon di atas label; hapus tab Audio, `MediaLibrary.tsx` dapat prop kategori + sub-nav (All/Video/Audio/Images). `PHONE_ASSET_TABS` ikut. Sesuaikan `AssetPanel.tsx`, sheet HP, dan test tab (`templatesTab`, `effectsTab`).
4. **Preview header + Transport** — `AdvancedEdit.tsx` player section (:1806) jadi panel ber-header; AspectPicker pindah ke header. Transport: varian baru di `editor/ClipPreview.tsx:1361` (prop mis. `variant="deck"`, dipakai Advanced saja) memakai `FrameStep` (`Chrome.tsx:539`) + tombol Home/End yang memanggil seek playback yang sudah ada; slider tidak dirender. Resolusi/fps dari export preset/canvas aspect (`exportPresets.ts`, ADR 0022).
5. **Inspector inline rows + collapsible groups** — konteks `InspectorLayout` di `Inspector.tsx`; `Group` (`editor/StyleFields.tsx:27`) dan `Slider` (`components/Slider.tsx:34`) membaca konteks: varian inline = label kiri, number/output kanan, slider lebar penuh hanya bila perlu; `Group` jadi `<details>`-style dengan chevron (pola `MoreOptions.tsx`). Status lipat di store `layout` `workspaceLayout.ts:184` (key per judul grup), tes di `workspaceLayout.test.ts`.
6. **Timeline toolbar** — `AdvancedTimeline.tsx:322-363`: slot `history` di kiri, pemisah antar grup (`ToolDivider` kecil), tombol Tambah Teks/Audio (callback set `assetTab` + buka panel kiri bila tersembunyi). `ItemTools` (`Chrome.tsx:460`) tetap. Track header (`Tracks.tsx:1325`) hanya dirapikan spacing (lock/eye/mute sudah ada).
7. **HP** — pakai Transport baru di player HP, panel flat untuk Sheet tetap glass; Toolbar HP tanpa tab Audio (masuk Media).

## Verifikasi
- `cd frontend && npx vitest run src/pages/job/advanced/<file-terkait>` (hanya tes fitur: exportButton, workspaceLayout, divider, bottomTabs, templatesTab, effectsTab, aspectPicker, meters + tes baru transport/inspector-inline/asset-tabs). Jangan full suite.
- `npx tsc --noEmit` di frontend.
- Jalankan app (skill `run`) dan screenshot desktop ≥64rem dan lebar HP; bandingkan dengan screenshot Concat; cek light & dark theme, keyboard (Tab ke grup collapsible, ←/→ frame step, Home/End).
