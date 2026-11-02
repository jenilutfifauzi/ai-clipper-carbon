import { AlertTriangle, Check, KeyRound, Link2, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { api, type AppSettings, type SettingsProvider } from "../api";
import { Button } from "../components/Button";
import { Select } from "../components/Select";

const FIELD = "min-h-11 w-full rounded-[10px] border border-border bg-fill px-3 text-base";
const PROVIDERS: { value: SettingsProvider; label: string }[] = [
  { value: "gemini", label: "Google Gemini" },
  { value: "openai-compatible", label: "OpenAI-compatible (OpenAI, DeepSeek, dan lainnya)" },
];

export function SettingsPage() {
  const id = useId();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [provider, setProvider] = useState<SettingsProvider>("gemini");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [thinking, setThinking] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingCookies, setRemovingCookies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getSettings().then((current) => {
      if (!active) return;
      setSettings(current);
      setProvider(current.provider);
      setModel(current.model);
      setBaseUrl(current.base_url ?? "https://api.deepseek.com");
      setThinking(current.thinking);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Pengaturan gagal dimuat.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.saveSettings({
        provider,
        model: model.trim(),
        ...(provider === "openai-compatible" ? { base_url: baseUrl.trim() } : {}),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        thinking,
      });
      setSettings(updated);
      setApiKey("");
      setNotice("Pengaturan AI tersimpan dan langsung berlaku untuk pemrosesan berikutnya.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pengaturan AI gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadCookies(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      setSettings(await api.uploadYoutubeCookies(file));
      setNotice("Cookies YouTube tersimpan. Unduhan YouTube berikutnya akan memakainya.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "File cookies gagal diunggah.");
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  async function removeCookies() {
    setRemovingCookies(true);
    setError(null);
    setNotice(null);
    try {
      await api.deleteYoutubeCookies();
      setSettings((current) => current ? { ...current, youtube_cookies_uploaded: false } : current);
      setNotice("File cookies YouTube sudah dihapus.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "File cookies gagal dihapus.");
    } finally {
      setRemovingCookies(false);
    }
  }

  const suggestions = provider === "gemini"
    ? ["gemini-3.8-flash"]
    : ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-accent-text">AI Clipper</p>
        <h1 className="text-2xl font-semibold tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted">Atur penyedia AI dan akses YouTube untuk pekerjaan baru.</p>
      </div>

      <div role="note" className="flex items-start gap-3 rounded-panel border border-waiting/40 bg-waiting-surface p-4 text-sm">
        <AlertTriangle aria-hidden size={18} className="mt-0.5 shrink-0 text-waiting" />
        <p className="text-pretty">
          Pengaturan ini hanya berlaku untuk akunmu. API key dan cookies disimpan di server pada workspace akun yang terpisah; jangan bagikan sesi akunmu.
        </p>
      </div>

      <section aria-labelledby={`${id}-ai`} className="glass flex flex-col gap-4 rounded-panel p-4 sm:p-5">
        <div>
          <h2 id={`${id}-ai`} className="font-semibold">Model AI</h2>
          <p className="mt-1 text-sm text-muted">Pilih penyedia, lalu masukkan ID model yang tersedia pada akun API-mu.</p>
        </div>
        {loading ? <p className="text-sm text-muted">Memuat pengaturan…</p> : (
          <form onSubmit={save} className="flex flex-col gap-4">
            <Select
              label="Penyedia AI"
              value={provider}
              options={PROVIDERS}
              onChange={(value) => {
                setProvider(value);
                setModel(value === "gemini" ? "gemini-3.8-flash" : "deepseek-flash");
              }}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-model`} className="text-sm font-medium">Model</label>
              <input
                id={`${id}-model`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                list={`${id}-model-options`}
                required
                maxLength={160}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className={FIELD}
                placeholder={provider === "gemini" ? "gemini-3.8-flash" : "deepseek-flash"}
              />
              <datalist id={`${id}-model-options`}>
                {suggestions.map((name) => <option key={name} value={name} />)}
              </datalist>
              <p className="text-xs text-muted">Bisa pilih saran atau ketik ID model lain.</p>
            </div>
            {provider === "openai-compatible" && (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-url`} className="text-sm font-medium">Base URL API</label>
                <input
                  id={`${id}-url`}
                  type="url"
                  autoComplete="url"
                  spellCheck={false}
                  required
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className={FIELD}
                  placeholder="https://api.deepseek.com"
                />
                <p className="text-xs text-muted">Masukkan alamat API kompatibel chat completions; tanpa akhiran <code>/chat/completions</code>.</p>
              </div>
            )}
            {provider === "openai-compatible" && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} className="mt-1 size-4 accent-accent" />
                <span>Aktifkan mode reasoning untuk DeepSeek (diabaikan oleh penyedia lain).</span>
              </label>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-key`} className="flex items-center gap-1.5 text-sm font-medium">
                <KeyRound aria-hidden size={14} /> API key {settings?.provider === provider && settings.api_key_configured ? "(sudah tersimpan)" : ""}
              </label>
              <input
                id={`${id}-key`}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className={FIELD}
                placeholder={settings?.provider === provider && settings.api_key_configured ? "Kosongkan untuk mempertahankan key saat ini" : "Tempel API key"}
              />
              <p className="text-xs text-muted">Key tidak pernah ditampilkan kembali. Kosongkan jika tidak ingin mengganti key yang sudah tersimpan.</p>
            </div>
            <Button type="submit" variant="primary" disabled={saving || loading} className="self-start">
              {saving ? "Menyimpan…" : "Simpan pengaturan AI"}
            </Button>
          </form>
        )}
      </section>

      <section aria-labelledby={`${id}-youtube`} className="glass flex flex-col gap-4 rounded-panel p-4 sm:p-5">
        <div>
          <h2 id={`${id}-youtube`} className="font-semibold">Cookies YouTube</h2>
          <p className="mt-1 text-sm text-muted">Unggah file <code>cookies.txt</code> format Netscape untuk membantu yt-dlp saat YouTube menolak unduhan.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={settings?.youtube_cookies_uploaded ? "text-success" : "text-muted"}>
            {settings?.youtube_cookies_uploaded ? "File cookies tersimpan" : "Belum ada file cookies"}
          </span>
          {settings?.youtube_cookies_uploaded && <Check aria-hidden size={16} className="text-success" />}
        </div>
        <label htmlFor={`${id}-cookies`} className="flex flex-wrap items-center gap-2">
          <span className="sr-only">Pilih file cookies YouTube</span>
          <input
            id={`${id}-cookies`}
            type="file"
            accept=".txt,text/plain"
            disabled={uploading}
            onChange={(event) => void uploadCookies(event)}
            className="min-w-0 flex-1 text-sm file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-control file:border-0 file:bg-fill file:px-3 file:font-medium file:text-text"
          />
          <span className="inline-flex items-center gap-2 text-sm text-muted"><Upload aria-hidden size={15} /> Maks. 2 MB</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {uploading && <span className="text-sm text-muted">Mengunggah…</span>}
          {settings?.youtube_cookies_uploaded && (
            <Button type="button" variant="danger" size="sm" disabled={removingCookies} onClick={() => void removeCookies()}>
              <Trash2 aria-hidden size={15} />
              {removingCookies ? "Menghapus…" : "Hapus cookies"}
            </Button>
          )}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted"><Link2 aria-hidden size={13} className="mt-0.5 shrink-0" /> Cookies disimpan di server aplikasi dengan izin akses terbatas, tidak ditampilkan kembali, dan digunakan hanya untuk unduhan YouTube berikutnya.</p>
      </section>

      {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-control border border-success/30 bg-success/10 px-3 py-2 text-sm">{notice}</p>}
    </div>
  );
}
