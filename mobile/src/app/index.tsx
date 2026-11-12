import { AuthView, UserButton } from "@clerk/expo/native-components";
import { useAuth } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { ApiClient, ApiError, type Job, type JobOptions } from "@/lib/api";
import { accountFeaturesConfigured } from "@/lib/config";
import { statusLabel } from "@/lib/jobStatus";
import { colors, TOUCH_TARGET } from "@/lib/theme";
import { isYouTubeUrl } from "@/lib/youtube";

// `@clerk/expo/native-components` types its lazily loaded components as opaque; these are the
// props `@clerk/expo-native-components` documents for AuthView.
const NativeAuthView = AuthView as unknown as React.ComponentType<{
  onDismiss?: () => void;
}>;
const NativeUserButton = UserButton as unknown as React.ComponentType;

const options: JobOptions = {
  language: "id",
  min_secs: 20,
  max_secs: 90,
  captions: true,
  brief: null,
  transcribe_locally: false,
  template: "default",
  aspect: "9:16",
};

type JobList = {
  jobs: Job[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
};

function HomeFrame({
  account,
  children,
  error,
  list,
}: {
  account?: ReactNode;
  children: ReactNode;
  error: string | null;
  list: JobList | null;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <FlatList
          data={list?.jobs ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            list ? (
              <RefreshControl
                refreshing={list.refreshing}
                onRefresh={list.onRefresh}
                tintColor={colors.accentSoft}
                colors={[colors.accent]}
                progressBackgroundColor={colors.surface}
              />
            ) : undefined
          }
          ListHeaderComponent={
            <>
              <View style={styles.header}>
                <View style={styles.flex}>
                  <Text style={styles.eyebrow}>AI CLIPPER</Text>
                  <Text accessibilityRole="header" style={styles.title}>
                    Buat klip pendek
                  </Text>
                </View>
                {account}
              </View>
              {children}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Render di perangkat</Text>
                <Text style={styles.muted}>
                  Potong video dari galeri menjadi klip 9:16 dengan caption,
                  hook, dan watermark. Video tidak diunggah.
                </Text>
                <Button
                  variant="secondary"
                  label="Buka Local Render"
                  onPress={() => router.push("/local-render")}
                />
              </View>
              {list ? (
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Pekerjaan terbaru
                </Text>
              ) : null}
            </>
          }
          ListEmptyComponent={
            list ? (
              list.loading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.muted}>Belum ada pekerjaan.</Text>
              )
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.url || "Upload lokal"}, ${statusLabel(item.status)}`}
              android_ripple={{ color: colors.ripple }}
              style={({ pressed }) => [styles.jobRow, pressed && styles.pressed]}
              onPress={() => router.push(`/job/${item.id}`)}
            >
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.jobUrl}>
                  {item.url || "Upload lokal"}
                </Text>
                <Text numberOfLines={2} style={styles.muted}>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AccountHome() {
  const { isLoaded, isSignedIn, getToken } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const [authOpen, setAuthOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(() => new ApiClient(getToken), [getToken]);

  const loadJobs = useCallback(
    async (signal?: AbortSignal) => {
      if (!isSignedIn) return;
      try {
        const next = await client.listJobs(signal);
        setJobs(next);
        setError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setError(
          e instanceof ApiError ? e.message : "Tidak dapat memuat pekerjaan.",
        );
      }
      setLoaded(true);
    },
    [client, isSignedIn],
  );

  // Reload whenever the screen comes back into view, so a Job's status isn't stale after a visit
  // to its detail screen; leaving cancels the request in flight.
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      void loadJobs(controller.signal);
      return () => controller.abort();
    }, [loadJobs]),
  );

  useEffect(() => {
    if (isSignedIn) setAuthOpen(false);
  }, [isSignedIn]);

  async function startJob() {
    const value = url.trim();
    if (!isYouTubeUrl(value)) {
      setError("Masukkan URL YouTube yang valid.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const job = await client.createJob({ url: value, options });
      setUrl("");
      setJobs((old) => [job, ...old]);
      router.push(`/job/${job.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal memulai pekerjaan.");
    } finally {
      setStarting(false);
    }
  }

  if (!isLoaded || isSignedIn === undefined)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted}>Memuat sesi…</Text>
      </View>
    );

  return (
    <>
      <HomeFrame
        account={isSignedIn ? <NativeUserButton /> : null}
        error={error}
        list={
          isSignedIn
            ? {
                jobs,
                loading: !loaded,
                refreshing,
                onRefresh: () => {
                  setRefreshing(true);
                  void loadJobs().finally(() => setRefreshing(false));
                },
              }
            : null
        }
      >
        {isSignedIn ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sumber YouTube</Text>
            <TextInput
              accessibilityLabel="URL YouTube"
              value={url}
              onChangeText={setUrl}
              placeholder="https://youtube.com/watch?v=…"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void startJob()}
              style={styles.input}
            />
            <Button
              label="Mulai AI Job"
              loading={starting}
              onPress={() => void startJob()}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Masuk untuk mulai</Text>
            <Text style={styles.muted}>
              Login diperlukan untuk membuat dan melihat pekerjaan AI.
            </Text>
            <Button label="Masuk / Daftar" onPress={() => setAuthOpen(true)} />
          </View>
        )}
      </HomeFrame>
      <Modal
        animationType="slide"
        visible={authOpen}
        presentationStyle="pageSheet"
        onRequestClose={() => setAuthOpen(false)}
      >
        <NativeAuthView onDismiss={() => setAuthOpen(false)} />
      </Modal>
    </>
  );
}

export default function HomeScreen() {
  if (accountFeaturesConfigured) return <AccountHome />;
  return (
    <HomeFrame error={null} list={null}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Login belum dikonfigurasi</Text>
        <Text style={styles.muted}>
          Build ini dibuat tanpa kunci Clerk dan alamat server, jadi AI Job dari
          YouTube belum tersedia. Local Render di bawah tetap berfungsi penuh.
        </Text>
      </View>
    </HomeFrame>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 28,
  },
  eyebrow: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: "800", marginTop: 6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 24,
    gap: 12,
  },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  input: {
    backgroundColor: colors.field,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: TOUCH_TARGET,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 15,
    marginBottom: 9,
    minHeight: TOUCH_TARGET,
    overflow: "hidden",
  },
  pressed: { opacity: 0.82 },
  jobUrl: { color: colors.text, fontSize: 14, marginBottom: 5 },
  progress: { color: colors.accentText, fontWeight: "700" },
  chevron: { color: colors.textMuted, fontSize: 26 },
});
