/**
 * Typed client for the A++ backend.
 *
 * Every call goes through `request()` so error shaping, timeouts and the base
 * URL are handled once rather than per page.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') ?? 'http://localhost:8000';

export type RunStatus =
  | 'generated'
  | 'passed'
  | 'failed'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'provider_failed';

export type JobStatus = 'queued' | 'in_progress' | 'complete' | 'failed' | 'not_found';

export interface Violation {
  rule: string;
  severity: 'error' | 'warning';
  evidence: string;
}

export interface Compliance {
  passed: boolean;
  status: 'passed' | 'failed' | 'needs_review';
  violations: Violation[];
  error_count: number;
  warning_count: number;
  checks_run: string[];
  judge: string | null;
  degraded: boolean;
  text_seen: string;
  notes: string;
}

export interface Run {
  run_id: string;
  parent_run_id: string | null;
  job_id: string | null;
  asin: string;
  module_id: string;
  attempt: number;
  version?: number;
  succeeded: boolean;
  provider: string | null;
  model: string | null;
  status: RunStatus;
  review_decision: string | null;
  asset_url: string | null;
  asset_sha256: string | null;
  manifest_uri: string | null;
  canonical_hash: string | null;
  cost_usd: number;
  duration_sec: number | null;
  error: string | null;
  compliance: Compliance | null;
  violations: Violation[];
  created_at: string | null;
  duplicate_count?: number;
}

export interface LoopResult {
  asin: string;
  module_id: string;
  approved: boolean;
  attempts: number;
  total_cost_usd: number;
  run_id: string | null;
  asset_url: string | null;
  manifest_uri: string | null;
  compliance: Compliance | null;
  lineage: unknown[];
}

export interface Job {
  job_id: string;
  status: JobStatus;
  asin: string | null;
  module_id: string | null;
  result: LoopResult | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ModuleOption {
  id: string;
  label: string;
  display: string;
  aspect_ratio: string;
  canvas: string;
  notes: string;
}

export interface ProviderSlot {
  position: number;
  provider: string;
  model: string;
  est_cost_usd: number;
  role: string;
  status: string;
}

export interface Health {
  status: string;
  config: Record<string, string>;
  providers: ProviderSlot[];
  disabled_providers: Record<string, string>;
  vision_judges: { backend: string; model: string; status: string }[];
  queue_depth: number;
}

export interface Stats {
  total_runs: number;
  total_asins: number;
  total_cost_usd: number;
  overall_pass_rate: number | null;
  status_counts: Record<string, number>;
  cost_per_asin: { asin: string; cost_usd: number }[];
  per_provider: {
    provider: string;
    attempts: number;
    passed: number;
    failed: number;
    errors: number;
    cost_usd: number;
    pass_rate: number | null;
  }[];
  avg_attempts_per_job: number | null;
}

export interface VerifyResult {
  valid: boolean;
  found: boolean;
  source: string;
  manifest: Record<string, unknown> | null;
  integrity: {
    valid: boolean;
    hash_ok: boolean;
    canonical_hash: string | null;
    unverified_assets: string[];
    invalid_metadata: string[];
    note?: string;
  } | null;
  run: Run | null;
  lineage: Run[];
  message: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the API at ${API_BASE}. Is the backend running?`,
      0,
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep the status line */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<Health>('/health'),
  modules: () => request<ModuleOption[]>('/modules'),

  generate: (body: {
    asin: string;
    module_id: string;
    brief: string;
    demo_violation?: 'pricing' | 'safe_zone' | null;
    force_fail_first?: boolean;
  }) =>
    request<{ job_id: string; status: string; asin: string; module_id: string }>('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  job: (jobId: string) => request<Job>(`/jobs/${jobId}`),
  run: (runId: string) => request<Run>(`/runs/${runId}`),
  lineage: (runId: string) => request<Run[]>(`/runs/${runId}/lineage`),
  reviewQueue: () => request<Run[]>('/review?limit=100'),

  review: (runId: string, decision: 'approved' | 'rejected') =>
    request<{ run_id: string; status: string }>(`/runs/${runId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }),

  gallery: (params: { view?: string; asin?: string; module_id?: string; status?: string } = {}) => {
    const q = new URLSearchParams({ limit: '120' });
    Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
    return request<{ view: string; count: number; items: Run[] }>(`/gallery?${q}`);
  },

  stats: () => request<Stats>('/gallery/stats'),

  verify: async (payload: { file?: File; run_id?: string }) => {
    const form = new FormData();
    if (payload.file) form.append('file', payload.file);
    if (payload.run_id) form.append('run_id', payload.run_id);
    const res = await fetch(`${API_BASE}/verify`, { method: 'POST', body: form });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const b = await res.json();
        if (b?.detail) detail = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail);
      } catch {
        /* noop */
      }
      throw new ApiError(detail, res.status);
    }
    return (await res.json()) as VerifyResult;
  },

  exportUrl: (runId: string) => `${API_BASE}/runs/${runId}/export`,
};

/** Human-readable module label without another round trip. */
export const MODULE_LABELS: Record<string, string> = {
  header_970x600: 'Header 970×600',
  banner_970x300: 'Banner 970×300',
  card_300x300: 'Card 300×300',
  comparison_150x150: 'Comparison 150×150',
  grid_135x135: 'Grid 135×135',
};

export function money(n: number | null | undefined): string {
  if (n == null) return '—';
  return n === 0 ? '$0.00' : `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
}

export function shortId(id: string | null | undefined, n = 8): string {
  return id ? id.slice(0, n) : '—';
}

/** Asset URLs come back as API-relative paths (/asset?key=...) so the private
 *  B2 bucket is proxied rather than exposed. Resolve them against the API. */
export function assetSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}
