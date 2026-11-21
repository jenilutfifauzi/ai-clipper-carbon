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

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(
  /\/$/,
  "",
);
const API_ROOT = configuredBaseUrl ? `${configuredBaseUrl}/api` : "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type TokenGetter = () => Promise<string | null>;

export class ApiClient {
  constructor(private readonly getToken: TokenGetter) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!API_ROOT) {
      throw new ApiError("EXPO_PUBLIC_API_BASE_URL belum dikonfigurasi.", 0);
    }
    const token = await this.getToken();
    if (!token) throw new ApiError("Sesi login tidak tersedia.", 401);
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
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

  listJobs(): Promise<Job[]> {
    return this.request<Job[]>("/jobs");
  }

  createJob(body: JobRequest): Promise<Job> {
    return this.request<Job>("/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getJob(jobId: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/jobs/${encodeURIComponent(jobId)}`);
  }
}
