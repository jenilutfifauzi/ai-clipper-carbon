export type LocalCaptionCueDraft = {
  id: string;
  start: string;
  end: string;
  text: string;
};

export type LocalCaptionCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  words: {
    text: string;
    startSeconds: number;
    endSeconds: number;
  }[];
};

export type LocalOverlayPlan = {
  captions: LocalCaptionCue[];
  hookText: string;
  watermarkText: string;
  watermarkOpacity: number;
};

export type LocalOverlayPlanResult = {
  plan: LocalOverlayPlan | null;
  error: string | null;
};

const MAX_CUES = 50;
const MAX_CUE_CHARACTERS = 160;
const MAX_HOOK_CHARACTERS = 120;
const MAX_WATERMARK_CHARACTERS = 40;

function localizedSeconds(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function invalid(error: string): LocalOverlayPlanResult {
  return { plan: null, error };
}

export function buildLocalOverlayPlan(
  drafts: LocalCaptionCueDraft[],
  hookValue: string,
  watermarkValue: string,
  trimDurationSeconds: number,
): LocalOverlayPlanResult {
  if (!Number.isFinite(trimDurationSeconds) || trimDurationSeconds <= 0) {
    return invalid("Rentang klip tidak valid untuk caption.");
  }
  if (drafts.length > MAX_CUES) {
    return invalid(`Maksimal ${MAX_CUES} caption per render.`);
  }

  const hookText = hookValue.trim();
  const watermarkText = watermarkValue.trim();
  if (characterCount(hookText) > MAX_HOOK_CHARACTERS) {
    return invalid(`Hook maksimal ${MAX_HOOK_CHARACTERS} karakter.`);
  }
  if (characterCount(watermarkText) > MAX_WATERMARK_CHARACTERS) {
    return invalid(`Watermark maksimal ${MAX_WATERMARK_CHARACTERS} karakter.`);
  }

  const captions: LocalCaptionCue[] = [];
  for (const draft of drafts) {
    const text = draft.text.trim().replace(/\s+/g, " ");
    const startSeconds = localizedSeconds(draft.start);
    const endSeconds = localizedSeconds(draft.end);
    if (!text) return invalid("Isi teks setiap caption atau hapus barisnya.");
    if (characterCount(text) > MAX_CUE_CHARACTERS) {
      return invalid(`Setiap caption maksimal ${MAX_CUE_CHARACTERS} karakter.`);
    }
    if (
      startSeconds === null ||
      endSeconds === null ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      endSeconds > trimDurationSeconds + 0.001
    ) {
      return invalid(
        "Waktu caption harus valid dan berada di dalam klip yang akan dirender.",
      );
    }
    const spokenWords = text.split(/\s+/);
    const wordSpan = (endSeconds - startSeconds) / spokenWords.length;
    const words = spokenWords.map((word, index) => ({
      text: word,
      startSeconds: startSeconds + wordSpan * index,
      endSeconds:
        index === spokenWords.length - 1
          ? endSeconds
          : startSeconds + wordSpan * (index + 1),
    }));
    captions.push({ startSeconds, endSeconds, text, words });
  }

  captions.sort((left, right) => left.startSeconds - right.startSeconds);
  for (let index = 1; index < captions.length; index += 1) {
    if (captions[index].startSeconds < captions[index - 1].endSeconds - 0.001) {
      return invalid("Waktu caption tidak boleh saling bertumpuk.");
    }
  }

  return {
    plan: {
      captions,
      hookText,
      watermarkText,
      watermarkOpacity: 0.55,
    },
    error: null,
  };
}
