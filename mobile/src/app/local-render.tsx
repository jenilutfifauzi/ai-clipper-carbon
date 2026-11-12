import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { VideoView, useVideoPlayer } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import OnDeviceRenderer from "../../modules/on-device-renderer";
import { Button } from "@/components/Button";
import {
  buildLocalOverlayPlan,
  type LocalCaptionCueDraft,
} from "@/lib/localOverlayPlan";
import { renderErrorMessage } from "@/lib/renderErrors";
import { colors, TOUCH_TARGET } from "@/lib/theme";

type LocalVideo = {
  uri: string;
  name: string;
  durationMs: number | null;
};

type PreviewHandle = {
  /** The playhead, in seconds. */
  position: () => number;
  pause: () => void;
};

function VideoPreview({ uri, ref }: { uri: string; ref: Ref<PreviewHandle> }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  useImperativeHandle(
    ref,
    () => ({
      position: () => player.currentTime,
      pause: () => player.pause(),
    }),
    [player],
  );

  return (
    <VideoView
      player={player}
      style={styles.preview}
      contentFit="cover"
      nativeControls
    />
  );
}

function parseSeconds(value: string): number {
  return Number(value.trim().replace(",", "."));
}

/** Seconds as the trim fields show them: at most one decimal, no trailing ".0". */
function formatSeconds(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export default function LocalRenderScreen() {
  const [source, setSource] = useState<LocalVideo | null>(null);
  const [startText, setStartText] = useState("0");
  const [endText, setEndText] = useState("15");
  const [renderedUri, setRenderedUri] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<LocalCaptionCueDraft[]>([]);
  const [hookText, setHookText] = useState("");
  const [watermarkText, setWatermarkText] = useState("");
  const preview = useRef<PreviewHandle>(null);

  useEffect(() => {
    const subscription = OnDeviceRenderer.addListener(
      "onRenderProgress",
      ({ progress: nextProgress }) => {
        setProgress(nextProgress);
      },
    );
    return () => {
      subscription.remove();
      // Leaving the screen abandons the export; without this it would keep the encoder busy and
      // leave a file nobody can reach.
      OnDeviceRenderer.cancelRenderAsync().catch(() => {});
    };
  }, []);

  const trim = useMemo(
    () => ({
      start: parseSeconds(startText),
      end: parseSeconds(endText),
    }),
    [endText, startText],
  );
  const durationSeconds = source?.durationMs ? source.durationMs / 1000 : null;
  const validTrim = Boolean(
    source &&
      Number.isFinite(trim.start) &&
      Number.isFinite(trim.end) &&
      trim.start >= 0 &&
      trim.end > trim.start &&
      (durationSeconds === null || trim.end <= durationSeconds),
  );
  const overlayResult = useMemo(
    () =>
      buildLocalOverlayPlan(
        captionDrafts,
        hookText,
        watermarkText,
        trim.end - trim.start,
      ),
    [captionDrafts, hookText, trim.end, trim.start, watermarkText],
  );
  const hasOverlayDraft = Boolean(
    captionDrafts.length || hookText.trim() || watermarkText.trim(),
  );
  const overlayValid = !hasOverlayDraft || Boolean(overlayResult.plan);

  function addCaptionCue() {
    const duration = Math.max(0, trim.end - trim.start);
    const lastEnd = captionDrafts.reduce(
      (latest, cue) => Math.max(latest, parseSeconds(cue.end) || 0),
      0,
    );
    const start = Math.min(lastEnd, Math.max(0, duration - 1));
    const end = Math.min(duration, Math.max(start + 1, start + 3));
    setCaptionDrafts((old) => [
      ...old,
      {
        id: `${Date.now()}-${old.length}`,
        start: formatSeconds(start),
        end: formatSeconds(end),
        text: "",
      },
    ]);
    setRenderedUri(null);
  }

  function updateCaptionCue(id: string, changes: Partial<LocalCaptionCueDraft>) {
    setCaptionDrafts((old) =>
      old.map((cue) => (cue.id === id ? { ...cue, ...changes } : cue)),
    );
    setRenderedUri(null);
  }

  function setStart(value: string) {
    setStartText(value);
    setRenderedUri(null);
  }

  function setEnd(value: string) {
    setEndText(value);
    setRenderedUri(null);
  }

  async function pickVideo() {
    setError(null);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: false,
      });
    } catch {
      setError("Tidak dapat membuka galeri di perangkat ini.");
      return;
    }
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const durationMs = asset.duration ?? null;
    const safeDuration =
      durationMs && durationMs > 0 ? durationMs / 1000 : null;
    const defaultEnd = safeDuration
      ? Math.min(15, Math.floor(safeDuration))
      : 15;
    setSource({
      uri: asset.uri,
      name: asset.fileName || "video dari perangkat",
      durationMs,
    });
    setCaptionDrafts([]);
    setHookText("");
    setWatermarkText("");
    setStartText("0");
    setEndText(String(Math.max(1, defaultEnd)));
    setRenderedUri(null);
    setProgress(0);
  }

  function chooseVideo() {
    // Another video resets the trim and every text, so ask before throwing typed work away.
    if (!hasOverlayDraft) {
      void pickVideo();
      return;
    }
    Alert.alert(
      "Ganti video?",
      "Caption, hook, dan watermark yang sudah diisi akan dihapus.",
      [
        { text: "Batal", style: "cancel" },
        { text: "Ganti video", style: "destructive", onPress: () => void pickVideo() },
      ],
    );
  }

  async function renderClip() {
    if (!source || !validTrim || rendering) return;
    if (!overlayResult.plan) {
      setError(overlayResult.error || "Pengaturan overlay tidak valid.");
      return;
    }
    setError(null);
    setRendering(true);
    setProgress(0);
    setRenderedUri(null);
    // The preview's decoder competes with the export's on phones with few codec instances.
    preview.current?.pause();
    try {
      const plan = overlayResult.plan;
      const hasOverlays = Boolean(
        plan.captions.length || plan.hookText || plan.watermarkText,
      );
      const uri = hasOverlays
        ? await OnDeviceRenderer.renderPortraitClipWithOverlaysAsync(
            source.uri,
            trim.start * 1000,
            trim.end * 1000,
            JSON.stringify(plan),
          )
        : await OnDeviceRenderer.renderPortraitClipAsync(
            source.uri,
            trim.start * 1000,
            trim.end * 1000,
          );
      setRenderedUri(uri);
      setProgress(100);
    } catch (renderError) {
      setError(renderErrorMessage(renderError));
    } finally {
      setRendering(false);
    }
  }

  async function cancelRender() {
    try {
      await OnDeviceRenderer.cancelRenderAsync();
    } catch {
      setError("Tidak dapat membatalkan render yang sedang berjalan.");
    }
  }

  async function saveToGallery() {
    if (!renderedUri || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Write-only: Android 10 and later grant this without a prompt, and no read access is asked.
      const permission = await requestPermissionsAsync(true, ["video"]);
      if (!permission.granted) {
        setError(
          "Izin simpan video ditolak. Izinkan akses video untuk menyimpan hasil ke galeri.",
        );
        return;
      }
      await Asset.create(renderedUri);
      Alert.alert(
        "Tersimpan",
        "Klip portrait sudah disimpan ke galeri perangkat.",
      );
    } catch {
      setError("Tidak dapat menyimpan video ke galeri.");
    } finally {
      setSaving(false);
    }
  }

  async function shareVideo() {
    if (!renderedUri) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError("Fitur berbagi file tidak tersedia pada perangkat ini.");
        return;
      }
      await Sharing.shareAsync(renderedUri, {
        mimeType: "video/mp4",
        dialogTitle: "Bagikan klip AI Clipper",
      });
    } catch {
      setError("Tidak dapat membuka menu berbagi.");
    }
  }

  const renderBlocked = !validTrim || !overlayValid;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kembali"
              android_ripple={{ color: colors.ripple }}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.backText}>‹</Text>
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>EDITOR PERANGKAT</Text>
              <Text accessibilityRole="header" style={styles.title}>
                Local Render
              </Text>
            </View>
          </View>

          <Text style={styles.intro}>
            Pilih video dari ponsel, tentukan bagian yang dipakai, lalu render
            langsung di Android.
          </Text>

          {source ? (
            <View style={styles.previewBlock}>
              <View style={styles.previewLabelRow}>
                <Text style={styles.fieldLabel}>
                  {renderedUri ? "PRATINJAU · HASIL RENDER" : "PRATINJAU · VIDEO SUMBER"}
                </Text>
                {renderedUri ? (
                  <Button
                    variant="text"
                    label="Edit lagi"
                    accessibilityLabel="Kembali ke video sumber untuk mengedit lagi"
                    onPress={() => setRenderedUri(null)}
                  />
                ) : null}
              </View>
              <View style={styles.previewFrame}>
                <VideoPreview ref={preview} uri={renderedUri ?? source.uri} />
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pilih video dari galeri"
              android_ripple={{ color: colors.ripple }}
              style={({ pressed }) => [
                styles.emptyPreview,
                pressed && styles.pressed,
              ]}
              onPress={chooseVideo}
            >
              <Text style={styles.playMark}>▶</Text>
              <Text style={styles.emptyTitle}>Pilih video dari galeri</Text>
              <Text style={styles.mutedCentered}>
                Video tetap di perangkat; tidak diunggah untuk render ini.
              </Text>
            </Pressable>
          )}

          {source ? (
            <Button
              variant="secondary"
              label="Pilih video lain"
              disabled={rendering}
              onPress={chooseVideo}
            />
          ) : null}

          {source ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Potong klip</Text>
              <Text numberOfLines={1} style={styles.fileName}>
                {source.name}
              </Text>
              <View style={styles.rangeRow}>
                <View style={styles.rangeField}>
                  <Text style={styles.fieldLabel}>MULAI (DETIK)</Text>
                  <TextInput
                    accessibilityLabel="Waktu mulai dalam detik"
                    style={styles.input}
                    value={startText}
                    onChangeText={setStart}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                </View>
                <View style={styles.rangeField}>
                  <Text style={styles.fieldLabel}>AKHIR (DETIK)</Text>
                  <TextInput
                    accessibilityLabel="Waktu akhir dalam detik"
                    style={styles.input}
                    value={endText}
                    onChangeText={setEnd}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                </View>
              </View>
              {renderedUri ? null : (
                <View style={styles.rangeRow}>
                  <Button
                    variant="secondary"
                    label="Mulai di posisi video"
                    accessibilityLabel="Isi waktu mulai dari posisi pratinjau saat ini"
                    onPress={() =>
                      setStart(formatSeconds(preview.current?.position() ?? 0))
                    }
                    style={styles.rangeField}
                  />
                  <Button
                    variant="secondary"
                    label="Akhir di posisi video"
                    accessibilityLabel="Isi waktu akhir dari posisi pratinjau saat ini"
                    onPress={() =>
                      setEnd(formatSeconds(preview.current?.position() ?? 0))
                    }
                    style={styles.rangeField}
                  />
                </View>
              )}
              {durationSeconds !== null ? (
                <Text style={styles.muted}>
                  Durasi sumber {durationSeconds.toFixed(1)} detik.
                </Text>
              ) : null}
              {!validTrim ? (
                <Text style={styles.validation}>
                  Masukkan rentang waktu yang valid dan tidak melebihi durasi
                  sumber.
                </Text>
              ) : null}
            </View>
          ) : null}

          {source ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Teks dan branding</Text>
              <Text style={styles.muted}>
                Opsional. Waktu caption dihitung dari awal klip hasil potong.
                Kata disorot merata selama caption tampil; ini bukan transkripsi
                otomatis. Teks yang tidak muat ditolak agar tidak terpotong.
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>HOOK · 3 DETIK PERTAMA</Text>
                <TextInput
                  accessibilityLabel="Teks hook"
                  style={styles.input}
                  value={hookText}
                  onChangeText={(value) => {
                    setHookText(value);
                    setRenderedUri(null);
                  }}
                  maxLength={120}
                  placeholder="Contoh: Ini yang sering terlewat"
                  placeholderTextColor={colors.placeholder}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>WATERMARK · SELURUH KLIP</Text>
                <TextInput
                  accessibilityLabel="Teks watermark"
                  style={styles.input}
                  value={watermarkText}
                  onChangeText={(value) => {
                    setWatermarkText(value);
                    setRenderedUri(null);
                  }}
                  maxLength={40}
                  autoCapitalize="none"
                  placeholder="Contoh: @akunmu"
                  placeholderTextColor={colors.placeholder}
                />
              </View>

              {captionDrafts.map((cue, index) => (
                <View key={cue.id} style={styles.cueCard}>
                  <View style={styles.cueHeader}>
                    <Text style={styles.fieldLabel}>CAPTION {index + 1}</Text>
                    <Button
                      variant="danger"
                      label="Hapus"
                      accessibilityLabel={`Hapus caption ${index + 1}`}
                      onPress={() => {
                        setCaptionDrafts((old) =>
                          old.filter((item) => item.id !== cue.id),
                        );
                        setRenderedUri(null);
                      }}
                    />
                  </View>
                  <View style={styles.rangeRow}>
                    <View style={styles.rangeField}>
                      <Text style={styles.fieldLabel}>MULAI (DETIK)</Text>
                      <TextInput
                        accessibilityLabel={`Mulai caption ${index + 1} dalam detik`}
                        style={styles.input}
                        value={cue.start}
                        onChangeText={(value) =>
                          updateCaptionCue(cue.id, { start: value })
                        }
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                      />
                    </View>
                    <View style={styles.rangeField}>
                      <Text style={styles.fieldLabel}>AKHIR (DETIK)</Text>
                      <TextInput
                        accessibilityLabel={`Akhir caption ${index + 1} dalam detik`}
                        style={styles.input}
                        value={cue.end}
                        onChangeText={(value) =>
                          updateCaptionCue(cue.id, { end: value })
                        }
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                      />
                    </View>
                  </View>
                  <TextInput
                    accessibilityLabel={`Teks caption ${index + 1}`}
                    style={[styles.input, styles.multilineInput]}
                    value={cue.text}
                    onChangeText={(value) =>
                      updateCaptionCue(cue.id, { text: value })
                    }
                    maxLength={160}
                    multiline
                    textAlignVertical="top"
                    placeholder="Tulis teks caption"
                    placeholderTextColor={colors.placeholder}
                  />
                </View>
              ))}

              <Button
                variant="secondary"
                label="＋ Tambah caption"
                disabled={captionDrafts.length >= 50 || rendering}
                onPress={addCaptionCue}
              />
              {hasOverlayDraft && overlayResult.error ? (
                <Text accessibilityRole="alert" style={styles.validation}>
                  {overlayResult.error}
                </Text>
              ) : null}
            </View>
          ) : null}

          {source ? (
            <View style={styles.card}>
              <Button
                label="Render klip 9:16"
                loading={rendering}
                disabled={renderBlocked}
                onPress={() => void renderClip()}
              />
              {renderBlocked && !rendering ? (
                <Text style={styles.validation}>
                  {!validTrim
                    ? "Perbaiki rentang waktu di bagian Potong klip untuk merender."
                    : "Perbaiki teks atau waktu caption di atas untuk merender."}
                </Text>
              ) : null}
              {rendering ? (
                <View style={styles.progressWrap}>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: progress }}
                    style={styles.progressTrack}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.max(4, progress)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {progress}% · render di perangkat, biarkan aplikasi terbuka
                  </Text>
                  <Button
                    variant="danger"
                    label="Batalkan render"
                    onPress={() => void cancelRender()}
                  />
                </View>
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
            </View>
          ) : error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          {renderedUri ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Klip siap</Text>
              <Text style={styles.muted}>
                MP4 H.264 · 720 × 1280 · diproses sepenuhnya di ponsel.
              </Text>
              <Button
                label="Simpan ke galeri"
                loading={saving}
                onPress={() => void saveToGallery()}
              />
              <Button
                variant="secondary"
                label="Bagikan video…"
                onPress={() => void shareVideo()}
              />
            </View>
          ) : null}

          <Text style={styles.footnote}>
            Mendukung satu video, trim, crop tengah 9:16, caption manual
            bertiming, hook teks, dan watermark teks. Pratinjau belum
            menampilkan caption; timeline multi-track, transkripsi, logo, musik,
            template, dan efek lanjutan belum tersedia di editor native ini.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  backButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: 13,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  backText: { color: colors.text, fontSize: 34, lineHeight: 38, marginTop: -5 },
  pressed: { opacity: 0.82 },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", marginTop: 3 },
  intro: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  previewBlock: { gap: 4 },
  previewLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: TOUCH_TARGET,
  },
  emptyPreview: {
    aspectRatio: 9 / 16,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  previewFrame: {
    aspectRatio: 9 / 16,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#08070d",
  },
  preview: { width: "100%", height: "100%" },
  playMark: { color: colors.accentSoft, fontSize: 32, marginBottom: 4 },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  mutedCentered: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 17,
    gap: 14,
  },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  cueCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 13,
    padding: 12,
    gap: 10,
  },
  cueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  multilineInput: { minHeight: 74, paddingTop: 12 },
  fileName: { color: colors.textSecondary, fontSize: 13 },
  rangeRow: { flexDirection: "row", gap: 12 },
  rangeField: { flex: 1, gap: 7 },
  fieldGroup: { gap: 7 },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: colors.field,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: TOUCH_TARGET,
  },
  validation: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  progressWrap: { gap: 8 },
  progressTrack: {
    height: 7,
    backgroundColor: colors.track,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: 7, backgroundColor: colors.accentSoft, borderRadius: 4 },
  progressText: { color: colors.textSecondary, fontSize: 13, textAlign: "center" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
