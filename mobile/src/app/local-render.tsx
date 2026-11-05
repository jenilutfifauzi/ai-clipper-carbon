import { useEffect, useMemo, useState } from "react";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import * as Sharing from "expo-sharing";
import { VideoView, useVideoPlayer } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import OnDeviceRenderer from "../../modules/on-device-renderer";
import { buildLocalOverlayPlan, type LocalCaptionCueDraft } from "../lib/localOverlayPlan";

type LocalVideo = {
  uri: string;
  name: string;
  durationMs: number | null;
};

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });

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

  useEffect(() => {
    const subscription = OnDeviceRenderer.addListener(
      "onRenderProgress",
      ({ progress: nextProgress }) => {
        setProgress(nextProgress);
      },
    );
    return () => subscription.remove();
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
        start: String(start),
        end: String(end),
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

  async function chooseVideo() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: false,
      quality: 1,
    });
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
      const message =
        renderError instanceof Error
          ? renderError.message
          : "Render gagal di perangkat ini.";
      setError(
        message.includes("E_RENDER_CANCELLED") ? "Render dibatalkan." : message,
      );
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
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Tidak dapat menyimpan video ke galeri.",
      );
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
    } catch (shareError) {
      setError(
        shareError instanceof Error
          ? shareError.message
          : "Tidak dapat membuka menu berbagi.",
      );
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kembali"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Text style={styles.backText}>‹</Text>
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>EDITOR PERANGKAT</Text>
              <Text style={styles.title}>Local Render</Text>
            </View>
          </View>

          <Text style={styles.intro}>
            Pilih video dari ponsel, tentukan bagian yang dipakai, lalu render
            langsung di Android.
          </Text>

          {source ? (
            <View style={styles.previewFrame}>
              <VideoPreview uri={renderedUri ?? source.uri} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              style={styles.emptyPreview}
              onPress={() => void chooseVideo()}
            >
              <Text style={styles.playMark}>▶</Text>
              <Text style={styles.emptyTitle}>Pilih video dari galeri</Text>
              <Text style={styles.muted}>
                Video tetap di perangkat; tidak diunggah untuk render ini.
              </Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={() => void chooseVideo()}
          >
            <Text style={styles.secondaryText}>
              {source ? "Pilih video lain" : "Pilih video"}
            </Text>
          </Pressable>

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
                    onChangeText={setStartText}
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
                    onChangeText={setEndText}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                </View>
              </View>
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
              <Pressable
                accessibilityRole="button"
                disabled={!validTrim || rendering || !overlayValid}
                style={[
                  styles.primaryButton,
                  (!validTrim || rendering || !overlayValid) && styles.disabled,
                ]}
                onPress={() => void renderClip()}
              >
                {rendering ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>Render klip 9:16</Text>
                )}
              </Pressable>
              {rendering ? (
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.max(4, progress)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {progress}% · render di perangkat
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void cancelRender()}
                    style={styles.cancelButton}
                  >
                    <Text style={styles.cancelText}>Batalkan render</Text>
                  </Pressable>
                </View>
              ) : null}
              </View>
            ) : null}

          {source ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Teks dan branding</Text>
              <Text style={styles.muted}>
                Waktu caption dihitung dari awal klip hasil potong. Kata disorot
                merata selama cue; ini bukan transkripsi atau timing suara otomatis.
                Jika teks tidak muat, render ditolak agar tidak ada kata yang terpotong.
              </Text>

              <View style={styles.rangeField}>
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
                  placeholderTextColor="#777386"
                />
              </View>

              <View style={styles.rangeField}>
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
                  placeholder="Contoh: @akunmu"
                  placeholderTextColor="#777386"
                />
              </View>

              {captionDrafts.map((cue, index) => (
                <View key={cue.id} style={styles.cueCard}>
                  <View style={styles.cueHeader}>
                    <Text style={styles.fieldLabel}>CAPTION {index + 1}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Hapus caption ${index + 1}`}
                      onPress={() => {
                        setCaptionDrafts((old) =>
                          old.filter((item) => item.id !== cue.id),
                        );
                        setRenderedUri(null);
                      }}
                    >
                      <Text style={styles.removeText}>Hapus</Text>
                    </Pressable>
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
                    placeholderTextColor="#777386"
                  />
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                disabled={captionDrafts.length >= 50 || rendering}
                style={[
                  styles.secondaryButton,
                  (captionDrafts.length >= 50 || rendering) && styles.disabled,
                ]}
                onPress={addCaptionCue}
              >
                <Text style={styles.secondaryText}>＋ Tambah caption</Text>
              </Pressable>
              {hasOverlayDraft && overlayResult.error ? (
                <Text accessibilityRole="alert" style={styles.validation}>
                  {overlayResult.error}
                </Text>
              ) : null}
            </View>
          ) : null}

          {renderedUri ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Klip siap</Text>
              <Text style={styles.muted}>
                MP4 H.264 · 720 × 1280 · trim, crop, dan teks overlay (jika diisi) diproses di ponsel.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                style={[styles.primaryButton, saving && styles.disabled]}
                onPress={() => void saveToGallery()}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>Simpan ke galeri</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={() => void shareVideo()}
              >
                <Text style={styles.secondaryText}>Bagikan video…</Text>
              </Pressable>
            </View>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Text style={styles.footnote}>
            Mendukung satu video, trim, crop tengah 9:16, caption manual bertiming,
            hook teks, dan watermark teks. Preview belum menunjukkan highlight
            caption yang tersinkron; timeline multi-track, transkripsi, logo,
            musik, template, keyframe, dan efek lanjutan belum tersedia di editor
            native ini.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0e0d16" },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#191725",
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: "#fff", fontSize: 34, lineHeight: 38, marginTop: -5 },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: "#9c92ff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  title: { color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 3 },
  intro: { color: "#aaa7b8", fontSize: 14, lineHeight: 21 },
  emptyPreview: {
    aspectRatio: 9 / 16,
    borderRadius: 20,
    backgroundColor: "#191725",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
    borderWidth: 1,
    borderColor: "#2b2938",
  },
  previewFrame: {
    aspectRatio: 9 / 16,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#08070d",
  },
  preview: { width: "100%", height: "100%" },
  playMark: { color: "#9c92ff", fontSize: 32, marginBottom: 4 },
  emptyTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  muted: { color: "#aaa7b8", fontSize: 13, lineHeight: 19 },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#3b384b",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryText: { color: "#d1ccff", fontSize: 14, fontWeight: "700" },
  card: { backgroundColor: "#191725", borderRadius: 18, padding: 17, gap: 14 },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  cueCard: {
    backgroundColor: "#211f2e",
    borderRadius: 13,
    padding: 12,
    gap: 10,
  },
  cueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  removeText: { color: "#ffc0c0", fontSize: 12, fontWeight: "700" },
  multilineInput: { minHeight: 74, paddingTop: 12 },
  fileName: { color: "#c3c0d0", fontSize: 13 },
  rangeRow: { flexDirection: "row", gap: 12 },
  rangeField: { flex: 1, gap: 7 },
  fieldLabel: {
    color: "#9a96a9",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  input: {
    backgroundColor: "#242132",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 46,
  },
  validation: { color: "#ffc28e", fontSize: 13, lineHeight: 18 },
  primaryButton: {
    minHeight: 49,
    borderRadius: 11,
    backgroundColor: "#6d5dfc",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.48 },
  progressWrap: { gap: 8 },
  progressTrack: {
    height: 7,
    backgroundColor: "#302d41",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: 7, backgroundColor: "#9c92ff", borderRadius: 4 },
  progressText: { color: "#c9c5d8", fontSize: 12, textAlign: "center" },
  cancelButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: "#ffc0c0", fontWeight: "700" },
  error: { color: "#ff9f9f", fontSize: 13, lineHeight: 19 },
  footnote: { color: "#7f7c8f", fontSize: 12, lineHeight: 18, marginTop: 4 },
});
