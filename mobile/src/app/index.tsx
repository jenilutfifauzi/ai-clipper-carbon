import { AuthView, UserButton } from "@clerk/expo/native-components";
import { useAuth } from "@clerk/expo";
import { Link, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiClient, ApiError, type Job } from "@/lib/api";

const NativeAuthView = AuthView as unknown as React.ComponentType<{
  onDismiss?: () => void;
}>;
const options = {
  language: "id",
  min_secs: 20,
  max_secs: 90,
  captions: true,
  brief: null,
  transcribe_locally: false,
  template: "default",
  aspect: "9:16" as const,
};
const statusLabel = (s: Job["status"]) =>
  ({
    queued: "Menunggu",
    downloading: "Mengunduh",
    transcribing: "Transkripsi",
    analyzing: "Analisis AI",
    review: "Siap ditinjau",
    rendering: "Merender",
    waiting_quota: "Menunggu kuota",
    error: "Gagal",
  })[s] ?? s;

export default function HomeScreen() {
  const { isLoaded, isSignedIn, getToken } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const [authOpen, setAuthOpen] = useState(false),
    [url, setUrl] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<string | null>(null);
  const client = useMemo(() => new ApiClient(getToken), [getToken]);
  const loadJobs = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      setJobs(await client.listJobs());
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Tidak dapat memuat pekerjaan.",
      );
    }
  }, [client, isSignedIn]);
  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);
  async function startJob() {
    const value = url.trim();
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(value)) {
      setError("Masukkan URL YouTube yang valid.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const job = await client.createJob({ url: value, options });
      setUrl("");
      setJobs((old) => [job, ...old]);
      router.push(`/job/${job.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal memulai pekerjaan.");
    } finally {
      setLoading(false);
    }
  }
  if (!isLoaded || isSignedIn === undefined)
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6d5dfc" />
        <Text style={styles.muted}>Memuat sesi…</Text>
      </View>
    );
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <FlatList
          data={isSignedIn ? jobs : []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await loadJobs();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <>
              <View style={styles.header}>
                <View>
                  <Text style={styles.eyebrow}>AI CLIPPER</Text>
                  <Text style={styles.title}>Buat klip pendek</Text>
                </View>
                {isSignedIn && Platform.OS !== "web" ? <UserButton /> : null}
              </View>
              {!isSignedIn ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Masuk untuk mulai</Text>
                  <Text style={styles.muted}>
                    Login diperlukan untuk membuat dan melihat pekerjaan AI.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.primary}
                    onPress={() => setAuthOpen(true)}
                  >
                    <Text style={styles.primaryText}>Masuk / Daftar</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Sumber YouTube</Text>
                  <TextInput
                    accessibilityLabel="URL YouTube"
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://youtube.com/watch?v=…"
                    placeholderTextColor="#8d8ba0"
                    autoCapitalize="none"
                    keyboardType="url"
                    style={styles.input}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={loading}
                    style={[styles.primary, loading && styles.disabled]}
                    onPress={() => void startJob()}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryText}>Mulai AI Job</Text>
                    )}
                  </Pressable>
                </View>
              )}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Pekerjaan terbaru</Text>
                <Link href="/local-render" asChild>
                  <Pressable accessibilityRole="button">
                    <Text style={styles.link}>Local Render →</Text>
                  </Pressable>
                </Link>
              </View>
            </>
          }
          ListEmptyComponent={
            isSignedIn
              ? () => <Text style={styles.muted}>Belum ada pekerjaan.</Text>
              : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              style={styles.jobRow}
              onPress={() => router.push(`/job/${item.id}`)}
            >
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.jobUrl}>
                  {item.url || "Upload lokal"}
                </Text>
                <Text style={styles.muted}>
                  {statusLabel(item.status)}
                  {item.message ? ` · ${item.message}` : ""}
                </Text>
              </View>
              {typeof item.progress === "number" ? (
                <Text style={styles.progress}>
                  {Math.round(item.progress * 100)}%
                </Text>
              ) : (
                <Text style={styles.chevron}>›</Text>
              )}
            </Pressable>
          )}
        />
        <Modal
          animationType="slide"
          visible={authOpen}
          presentationStyle="pageSheet"
          onRequestClose={() => setAuthOpen(false)}
        >
          {Platform.OS === "web" ? (
            <View style={styles.modalFallback}>
              <Text style={styles.cardTitle}>
                Auth native memerlukan development build.
              </Text>
              <Pressable
                style={styles.primary}
                onPress={() => setAuthOpen(false)}
              >
                <Text style={styles.primaryText}>Tutup</Text>
              </Pressable>
            </View>
          ) : (
            <NativeAuthView onDismiss={() => setAuthOpen(false)} />
          )}
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0e0d16" },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0e0d16",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  eyebrow: {
    color: "#9c92ff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
  },
  title: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 6 },
  card: {
    backgroundColor: "#191725",
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
    gap: 12,
  },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  muted: { color: "#aaa7b8", fontSize: 14, lineHeight: 21 },
  input: {
    backgroundColor: "#242132",
    color: "#fff",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
  },
  primary: {
    backgroundColor: "#6d5dfc",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.6 },
  error: { color: "#ff9f9f", marginBottom: 18 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  link: { color: "#aaa1ff", fontWeight: "700" },
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#191725",
    borderRadius: 12,
    padding: 15,
    marginBottom: 9,
  },
  jobUrl: { color: "#fff", fontSize: 14, marginBottom: 5 },
  progress: { color: "#b7afff", fontWeight: "700" },
  chevron: { color: "#aaa7b8", fontSize: 26 },
  modalFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 18,
  },
});
