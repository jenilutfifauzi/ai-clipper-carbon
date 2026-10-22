import type { PersonModelInfo } from "../../../api";

export type PersonModelAction = "download" | "cancel" | "remove";

export interface PersonModelState {
  // Null until it is first read.
  model: PersonModelInfo | null;
  // Why it couldn't be read, or why its Download, Cancel or Remove was refused.
  message: string | null;
}

export interface PersonModelDeps {
  read: () => Promise<PersonModelInfo>;
  download: () => Promise<PersonModelInfo>;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
  // Runs `run` after `ms`; returns what calls it off.
  after: (ms: number, run: () => void) => () => void;
}

export const PERSON_MODEL_POLL_MS = 1000;

const VERBS: Record<PersonModelAction, string> = {
  download: "download the person model",
  cancel: "cancel the person model's download",
  remove: "remove the person model",
};

/**
 * The person model's state (.scratch/background-removal/issues/01-person-model-download-and-remove.md),
 * as Kokoro's in the Narrate tab (VoicesSource): read when the Remove background section opens, and
 * polled every PERSON_MODEL_POLL_MS while it downloads, which the backend does in the background,
 * app-wide. Download, Cancel and Remove ask the backend and read it again; a refusal is told in
 * `message`. `subscribe` and `state` are for the section (useSyncExternalStore).
 */
export class PersonModelSource {
  state: PersonModelState = { model: null, message: null };
  private listeners = new Set<() => void>();
  private poll: (() => void) | null = null;
  // Bumped by every read and by dispose: an answer for an older one is dropped.
  private asked = 0;

  constructor(private deps: PersonModelDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Reads the model's state, and again shortly while it downloads. */
  load = async (): Promise<void> => {
    this.stopPolling();
    const asked = ++this.asked;
    let model: PersonModelInfo;
    try {
      model = await this.deps.read();
    } catch (reason) {
      if (asked !== this.asked) return;
      if (!this.state.model) this.set({ message: `Couldn't check the person model: ${reason instanceof Error ? reason.message : String(reason)}` });
      // A poll that failed is tried again: the download goes on in the backend.
      else if (this.state.model.state === "downloading") this.schedule();
      return;
    }
    if (asked !== this.asked) return;
    this.set({ model });
    if (model.state === "downloading") this.schedule();
  };

  /** The model's Download (or Retry), Cancel or Remove; its state read again after it. */
  act = async (action: PersonModelAction): Promise<void> => {
    this.set({ message: null });
    try {
      await this.deps[action]();
    } catch (reason) {
      this.set({ message: `Couldn't ${VERBS[action]}: ${reason instanceof Error ? reason.message : String(reason)}` });
    }
    await this.load();
  };

  /** The section closed: no more polling. */
  dispose = () => {
    this.asked += 1;
    this.stopPolling();
  };

  private schedule() {
    this.poll = this.deps.after(PERSON_MODEL_POLL_MS, () => {
      this.poll = null;
      void this.load();
    });
  }

  private stopPolling() {
    this.poll?.();
    this.poll = null;
  }

  private set(change: Partial<PersonModelState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
