import { api, type FontImported, type FontInfo } from "./api";
import { listStore } from "./listStore";

// The FontFace each Face is registered with, by its id, and the URL it was loaded from.
const registered = new Map<string, { url: string; face: FontFace }>();

// The Faces, each registered before it is listed.
const faces = listStore(registeredFonts);

/**
 * The Faces, bundled and imported, each registered with the document as a FontFace named by its id,
 * so that the preview sets text in the same files libass does. Loaded once; a failure is retried
 * next time.
 */
export const loadFonts = faces.load;

/** The Faces listed again, as after an import here or elsewhere: every `useFonts` gets them. */
export const reloadFonts = faces.reload;

/** Import a font file (TTF, OTF or TTC) for every Job, then list the Faces again. */
export async function importFont(file: File): Promise<FontImported> {
  const imported = await api.importFont(file);
  await reloadFonts().catch(() => {});
  return imported;
}

/** The Faces, null until they are loaded; listed again whenever they change. */
export const useFonts = (): FontInfo[] | null => faces.useList();

// The Faces as listed, each registered (and those no longer listed dropped from the document).
async function registeredFonts(): Promise<FontInfo[]> {
  const fonts = await api.listFonts();
  await Promise.all(fonts.map(register));
  const ids = new Set(fonts.map((font) => font.id));
  for (const [id, { face }] of registered) {
    if (ids.has(id)) continue;
    document.fonts.delete(face);
    registered.delete(id);
  }
  return fonts;
}

// A Face's file registered under its id, replacing the one before when its URL (its content) changed.
// One that fails to load is left out: the preview sets its text in the browser's fallback.
async function register(font: FontInfo) {
  const old = registered.get(font.id);
  if (old?.url === font.url) return;
  const face = new FontFace(fontFamily(font.id), `url(${font.url})`, { display: "block" });
  try {
    document.fonts.add(await face.load());
  } catch {
    return;
  }
  if (old) document.fonts.delete(old.face);
  registered.set(font.id, { url: font.url, face });
}

// The CSS font-family a Face is registered under.
export const fontFamily = (id: string) => `clip-${id}`;

// The CSS font size that sets `font` as libass does at `size`: libass makes the Windows ascent plus
// descent the size, a browser the em.
export const cssFontSize = (font: FontInfo, size: number) => (size * font.em) / font.units;
