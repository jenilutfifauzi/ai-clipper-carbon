import { api, fontUrl, type FontInfo } from "./api";

let loading: Promise<FontInfo[]> | null = null;

/**
 * The bundled fonts, each registered with the document as a FontFace named by its id, so that the
 * preview sets text in the same files libass does. Loaded once; a failure is retried next time.
 */
export function loadFonts(): Promise<FontInfo[]> {
  loading ??= api
    .listFonts()
    .then(async (fonts) => {
      await Promise.all(
        fonts.map(async (font) => {
          const face = new FontFace(fontFamily(font.id), `url(${fontUrl(font.id)})`, { display: "block" });
          document.fonts.add(await face.load());
        }),
      );
      return fonts;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

// The CSS font-family a bundled font is registered under.
export const fontFamily = (id: string) => `clip-${id}`;

// The CSS font size that sets `font` as libass does at `size`: libass makes the Windows ascent plus
// descent the size, a browser the em.
export const cssFontSize = (font: FontInfo, size: number) => (size * font.em) / font.units;
