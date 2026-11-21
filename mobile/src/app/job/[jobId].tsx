import { useAuth } from "@clerk/expo";
import { Link, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiClient, ApiError, type JobDetail } from "@/lib/api";

const labels: Record<string, string> = {
  queued: "Menunggu",
  downloading: "Mengunduh",
  transcribing: "Transkripsi",
  analyzing: "Analisis AI",
  review: "Siap ditinjau",
  rendering: "Merender",
  waiting_quota: "Menunggu kuota",
  error: "Gagal",
};

export default function JobDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { isLoaded, isSignedIn, getToken } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const client = useMemo(() => new ApiClient(getToken), [getToken]);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId || !isSignedIn) return;
    try {
      setJob(await client.getJob(jobId));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Gagal memuat detail job.",
      );
    }
  }, [client, isSignedIn, jobId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!job || ["review", "error"].includes(job.status)) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [job, load]);

  if (isLoaded && isSignedIn === false)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Masuk diperlukan</Text>
          <Text style={styles.muted}>
            Masuk kembali untuk melihat detail pekerjaan ini.
          </Text>
          <Link href="/" style={styles.link}>
            Ke beranda untuk masuk
          </Link>
        </View>
      </SafeAreaView>
    );

  if (!isLoaded || isSignedIn === undefined || !job)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color="#6d5dfc" />
          )}
          <Link href="/" style={styles.link}>
            ← Kembali
          </Link>
        </View>
      </SafeAreaView>
    );
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress * 100) : null;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/" style={styles.link}>
          ← Semua job
        </Link>
        <Text style={styles.title}>Detail pekerjaan</Text>
        <Text numberOfLines={2} style={styles.url}>
          {job.url || "Sumber lokal"}
        </Text>
        <View style={styles.statusCard}>
          <Text style={styles.status}>{labels[job.status] ?? job.status}</Text>
          {progress !== null ? (
            <Text style={styles.progress}>{progress}%</Text>
          ) : null}
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress ?? 0}%` }]} />
          </View>
          {job.message ? <Text style={styles.muted}>{job.message}</Text> : null}
          {job.error ? <Text style={styles.error}>{job.error}</Text> : null}
        </View>
        <Text style={styles.section}>Kandidat AI</Text>
        {job.candidates?.length ? (
          job.candidates.map((candidate) => (
            <View key={candidate.id} style={styles.candidate}>
              <Text style={styles.candidateTitle}>
                {candidate.title ||
                  candidate.hook_text ||
                  "Kandidat tanpa judul"}
              </Text>
              <Text style={styles.muted}>
                {Math.round(candidate.start)}–{Math.round(candidate.end)} detik
                · skor{" "}
                {candidate.predicted_score === null
                  ? "—"
                  : Math.round(candidate.predicted_score * 100) + "%"}
              </Text>
              {candidate.reason ? (
                <Text style={styles.reason}>{candidate.reason}</Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.muted}>
            Kandidat akan muncul setelah analisis selesai.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => void load()}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Perbarui status</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0e0d16" },
  content: { padding: 20, gap: 14 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    padding: 24,
  },
  link: { color: "#aaa1ff", fontSize: 15, fontWeight: "700" },
  title: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 10 },
  url: { color: "#aaa7b8", fontSize: 14 },
  statusCard: {
    backgroundColor: "#191725",
    padding: 18,
    borderRadius: 16,
    gap: 11,
  },
  status: { color: "#fff", fontSize: 20, fontWeight: "700" },
  progress: { color: "#b7afff", fontWeight: "700" },
  track: {
    height: 8,
    borderRadius: 8,
    backgroundColor: "#302b42",
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: "#6d5dfc" },
  section: { color: "#fff", fontSize: 19, fontWeight: "700", marginTop: 8 },
  candidate: {
    backgroundColor: "#191725",
    padding: 16,
    borderRadius: 14,
    gap: 7,
  },
  candidateTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  reason: { color: "#d4d0df", fontSize: 14, lineHeight: 20 },
  muted: { color: "#aaa7b8", fontSize: 14, lineHeight: 20 },
  error: { color: "#ff9f9f", textAlign: "center" },
  secondary: {
    borderColor: "#6d5dfc",
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
    alignItems: "center",
    marginTop: 6,
  },
  secondaryText: { color: "#c5bfff", fontWeight: "700" },
});
