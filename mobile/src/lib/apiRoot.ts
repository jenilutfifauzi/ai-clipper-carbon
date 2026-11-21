export type ApiRoot = { root: string | null; error: string | null };

/**
 * The `/api` root of the configured server. The client sends the Clerk session token to this
 * origin on every request, so anything but HTTPS is refused outside a development build.
 */
export function resolveApiRoot(
  value: string | undefined,
  allowInsecure: boolean,
): ApiRoot {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { root: null, error: "EXPO_PUBLIC_API_BASE_URL belum dikonfigurasi." };
  }
  const match = /^(https?):\/\/[^\s/?#]+$/i.exec(trimmed);
  if (!match) {
    return {
      root: null,
      error:
        "EXPO_PUBLIC_API_BASE_URL harus berupa origin, misalnya https://api.example.com.",
    };
  }
  if (match[1].toLowerCase() !== "https" && !allowInsecure) {
    return { root: null, error: "EXPO_PUBLIC_API_BASE_URL harus memakai HTTPS." };
  }
  return { root: `${trimmed}/api`, error: null };
}
