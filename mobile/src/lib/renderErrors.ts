const MESSAGES: Record<string, string> = {
  E_RENDER_CANCELLED: "Render dibatalkan.",
  E_RENDER_BUSY: "Render lain masih berjalan. Tunggu sampai selesai atau batalkan dulu.",
  E_RENDER_RANGE: "Rentang waktu klip tidak valid.",
  E_RENDER_SOURCE: "Hanya video yang tersimpan di perangkat ini yang bisa dirender.",
  E_RENDER_STORAGE: "Tidak dapat menyiapkan penyimpanan sementara. Periksa ruang kosong perangkat.",
  E_RENDER_CONTEXT: "Aplikasi belum siap merender. Tutup lalu buka kembali aplikasi.",
  E_RENDER_SETUP: "Video ini tidak dapat disiapkan untuk render.",
  E_RENDER_FAILED:
    "Perangkat gagal merender video ini. Coba rentang yang lebih pendek atau video lain.",
};

/**
 * The message to show for a failed render. The native module rejects with a stable `code`; its own
 * text is English and written for logs. Overlay validation (`E_OVERLAY_PLAN`) is the exception:
 * its message already says, in Indonesian, which text to shorten.
 */
export function renderErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === "E_OVERLAY_PLAN" && error instanceof Error && error.message) {
    return error.message;
  }
  return MESSAGES[code] ?? "Render gagal di perangkat ini.";
}
