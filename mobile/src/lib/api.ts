import { apiRoot } from "./config";

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "review"
  | "rendering"
  | "waiting_quota"
  | "error";

export type Aspect = "9:16" | "4:5" | "1:1" | "16:9";

export interface JobOptions {
  language: string;
  min_secs: number;
  max_secs: number;
  captions: boolean;
  brief: string | null;
  transcribe_locally: boolean;
  template: string | null;
  aspect: Aspect;
}

export interface JobRequest {
  url: string;
  options: JobOptions;
}

export interface JobWarning {
  stage: JobStatus;
  message: string;
}

export interface Job {
  id: string;
  url: string;
  options: JobOptions;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  stage: JobStatus | null;
  error: string | null;
  progress: number | null;
  message: string | null;
  warnings: JobWarning[];
  candidates?: Candidate[] | null;
}

export interface Candidate {
  id: string;
  start: number;
  end: number;
  title: string;
  hook_text: string;
  reason: string;
  predicted_score: number | null;
  emotion: string;
  selected: boolean;
}

export interface JobDetail extends Job {
  candidates: Candidate[] | null;
  transcript?: unknown;
  clips?: unknown[];
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type TokenGetter = () => Promise<string | null>;

const REQUEST_TIMEOUT_MS = 20_000;

type RequestOptions = { method?: "GET" | "POST"; body?: string; signal?: AbortSignal };

export class ApiClient {
  constructor(private readonly getToken: TokenGetter) {}

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!apiRoot.root) {
      throw new ApiError(apiRoot.error ?? "Server belum dikonfigurasi.", 0);
    }
    const token = await this.getToken();
    if (!token) throw new ApiError("Sesi login tidak tersedia.", 401);

    // One controller covers both the caller leaving the screen and a server that never answers.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort);

    let response: Response;
    try {
      response = await fetch(`${apiRoot.root}${path}`, {
        method: options.method ?? "GET",
        body: options.body,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(
        timedOut
          ? "Server tidak merespons. Coba lagi sebentar lagi."
          : "Tidak dapat terhubung ke server. Periksa koneksi internet.",
        0,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }

    if (!response.ok) {
      let message = `Permintaan gagal (${response.status}).`;
      try {
        const body = (await response.json()) as {
          detail?: string | { msg?: string }[];
        };
        if (typeof body.detail === "string") message = body.detail;
        else if (Array.isArray(body.detail))
          message =
            body.detail
              .map((item) => item.msg)
              .filter(Boolean)
              .join(", ") || message;
      } catch {
        // Keep the useful status fallback when the server did not return JSON.
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  }

  listJobs(signal?: AbortSignal): Promise<Job[]> {
    return this.request<Job[]>("/jobs", { signal });
  }

  createJob(body: JobRequest): Promise<Job> {
    return this.request<Job>("/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getJob(jobId: string, signal?: AbortSignal): Promise<JobDetail> {
    return this.request<JobDetail>(`/jobs/${encodeURIComponent(jobId)}`, {
      signal,
    });
  }
}
