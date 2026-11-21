import { useAuth } from "@clerk/expo";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { ApiClient, ApiError, type JobDetail } from "@/lib/api";
import { accountFeaturesConfigured } from "@/lib/config";
import { isSettled, statusLabel } from "@/lib/jobStatus";
import { colors } from "@/lib/theme";

const POLL_MS = 4000;

function goHome() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

function Notice({ title, body }: { title?: string; body?: string }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {body ? <Text style={styles.mutedCentered}>{body}</Text> : null}
        <Button variant="secondary" label="Kembali ke beranda" onPress={goHome} />
      </View>
    </SafeAreaView>
  );
}

function AccountJobDetail() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { isLoaded, isSignedIn, getToken } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const client = useMemo(() => new ApiClient(getToken), [getToken]);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const loading = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // A slow answer must not stack a second request on top of itself.
      if (!jobId || !isSignedIn || loading.current) return;
      loading.current = true;
      try {
        const next = await client.getJob(jobId, signal);
        setJob(next);
        setError(null);
      } catch (err) {
        if (!signal?.aborted)
          setError(
            err instanceof ApiError ? err.message : "Gagal memuat detail job.",
          );
      } finally {
        loading.current = false;
      }
    },
    [client, isSignedIn, jobId],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  // Poll only while this screen is in view, the app is in the foreground and the Job is still
  // moving; a Job in review or in error waits on the person, not the server.
  const settled = job ? isSettled(job.status) : false;
  useFocusEffect(
    useCallback(() => {
      if (!appActive) return;
      const controller = new AbortController();
      void load(controller.signal);
      const timer = settled
        ? null
        : setInterval(() => void load(controller.signal), POLL_MS);
      return () => {
        controller.abort();
        if (timer) clearInterval(timer);
      };
    }, [appActive, load, settled]),
  );

  if (isLoaded && isSignedIn === false)
    return (
      <Notice
        title="Masuk diperlukan"
        body="Masuk kembali dari beranda untuk melihat detail pekerjaan ini."
      />
    );

  if (!isLoaded || isSignedIn === undefined || !job) {
    if (error) return <Notice title="Tidak dapat memuat" body={error} />;
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const progress =
    typeof job.progress === "number" ? Math.round(job.progress * 100) : null;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.accentSoft}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <Button
          variant="text"
          label="‹ Semua job"
          accessibilityLabel="Kembali ke semua job"
          onPress={goHome}
          style={styles.back}
        />
        <Text accessibilityRole="header" style={styles.title}>
          Detail pekerjaan
        </Text>
        <Text numberOfLines={2} style={styles.muted}>
          {job.url || "Sumber lokal"}
        </Text>
        <View style={styles.statusCard}>
          <Text
            style={[styles.status, job.status === "error" && styles.statusError]}
          >
            {statusLabel(job.status)}
          </Text>
          {progress !== null ? (
            <>
              <Text style={styles.progress}>{progress}%</Text>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: progress }}
                style={styles.track}
              >
                <View style={[styles.fill, { width: `${progress}%` }]} />
              </View>
            </>
          ) : null}
          {job.message ? <Text style={styles.muted}>{job.message}</Text> : null}
          {job.error ? <Text style={styles.error}>{job.error}</Text> : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>
        <Text accessibilityRole="header" style={styles.section}>
          Kandidat AI
        </Text>
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
            {settled
              ? "Tidak ada kandidat untuk pekerjaan ini."
              : "Kandidat akan muncul setelah analisis selesai."}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function JobDetailScreen() {
  if (accountFeaturesConfigured) return <AccountJobDetail />;
  return (
    <Notice
      title="Login belum dikonfigurasi"
      body="Build ini dibuat tanpa kunci Clerk dan alamat server, jadi AI Job belum tersedia."
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    padding: 24,
  },
  back: { alignSelf: "flex-start", marginLeft: -8 },
  title: { color: colors.text, fontSize: 30, fontWeight: "800" },
  statusCard: {
    backgroundColor: colors.surface,
    padding: 18,
    borderRadius: 16,
    gap: 11,
  },
  status: { color: colors.text, fontSize: 20, fontWeight: "700" },
  statusError: { color: colors.danger },
  progress: { color: colors.accentText, fontWeight: "700" },
  track: {
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.track,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: colors.accent },
  section: { color: colors.text, fontSize: 19, fontWeight: "700", marginTop: 8 },
  candidate: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 14,
    gap: 7,
  },
  candidateTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  reason: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  mutedCentered: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
