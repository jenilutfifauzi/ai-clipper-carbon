const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/**
 * Whether the text is a link to YouTube. The phone app's Share button gives `m.youtube.com` and
 * `youtu.be` links, so the host is matched against a list rather than a `www.` prefix. The server
 * still decides whether the video itself can be used.
 */
export function isYouTubeUrl(value: string): boolean {
  const match = /^https?:\/\/([^\s/?#:@]+)(?::\d+)?\/\S+$/i.exec(value.trim());
  return match !== null && HOSTS.has(match[1].toLowerCase());
}
