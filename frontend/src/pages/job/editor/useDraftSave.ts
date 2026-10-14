import { useEffect, useRef, useState } from "react";

/**
 * A value edited as a draft and saved once changes pause for `delay` ms, and at once when the
 * component unmounts or `key` changes (another Candidate). The draft is shown until then; saves
 * coming back don't overwrite it. Returns the value to show and a setter.
 */
export function useDraftSave<T>(saved: T, save: (value: T) => void, key: string, delay = 700): [T, (value: T) => void] {
  const [draft, setDraft] = useState<{ key: string; value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ value: T; save: (value: T) => void } | null>(null);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) pending.current.save(pending.current.value);
    pending.current = null;
  };
  useEffect(() => flush, [key]);

  function set(value: T) {
    setDraft({ key, value });
    pending.current = { value, save };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }

  // A draft of another Candidate isn't shown.
  return [draft && draft.key === key ? draft.value : saved, set];
}
