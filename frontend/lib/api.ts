/**
 * Typed client for the A+ Foundry backend.
 *
 * Every call goes through `request()` so the base URL, error shaping and
 * "backend isn't running" get handled once instead of per page.
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

export interface Violation {
  rule: string;
  severity: 'error' | 'warning';
  evidence: string;
}

export interface AsinModuleRow {
  module_id: string;
  label: string;
  display: string;
  generated: boolean;
  run_id: string | null;
  asset_url: string | null;
  status: string;
  provider: string | null;
  attempts: number;
  readiness_score: number | null;
  readiness_grade: string | null;
  blocking: string[];
}

export interface AsinReport {
  asin: string;
  modules: AsinModuleRow[];
  summary: {
    modules_total: number;
    modules_generated: number;
    modules_compliant: number;
    modules_unresolved: number;
    readiness_score: number | null;
    weakest: {
      key: string;
      label: string;
      score: number;
      evidence: string | null;
      modules: string[];
    } | null;
    total_attempts: number;
    total_cost_usd: number;
    providers: { provider: string; attempts: number }[];
  };
}

export interface AsinListItem {
  asin: string;
  runs: number;
  modules: number;
  last_seen: string | null;
}

export interface ReadinessMetric {
  key: string;
  label: string;
  score: number;
  evidence: string;
}

/** Merchandising quality, scored from the pixels. Separate from pass/fail:
 *  a compliant asset can still be a weak listing image. */
export interface Readiness {
  score: number | null;
  grade: 'excellent' | 'good' | 'fair' | 'weak' | null;
  metrics: ReadinessMetric[];
  unavailable: string | null;
}

export interface Compliance {
  passed: boolean;
  status: 'passed' | 'failed' | 'needs_review';
  violations: Violation[];
  checks_run: string[];
  judge: string | null;
  degraded: boolean;
  text_seen: string;
  notes: string;
  readiness?: Readiness;
}

export interface Run {
  run_id: string;
  parent_run_id: string | null;
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
  canonical_hash: string | null;
  cost_usd: number;
  duration_sec: number | null;
  error: string | null;
  compliance: Compliance | null;
  violations: Violation[];
  created_at: string | null;
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

export interface Health {
  status: string;
  config: Record<string, string>;
  providers: {
    position: number;
    provider: string;
    model: string;
    est_cost_usd: number;
    role: string;
    status: string;
  }[];
  disabled_providers: Record<string, string>;
  vision_judges: { backend: string; model: string; status: string }[];
  queue_depth: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_BASE} — is the backend running?`, 0);
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

export interface ModuleOption {
  id: string;
  label: string;
  display: string;
  aspect_ratio: string;
  canvas: string;
  notes: string;
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
  } | null;
  run: Run | null;
  lineage: Run[];
  message: string | null;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_BASE} — is the backend running?`, 0);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.detail) detail = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail);
    } catch {
      /* keep the status line */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
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
}

export interface Job {
  job_id: string;
  status: 'queued' | 'in_progress' | 'complete' | 'failed' | 'not_found';
  asin: string | null;
  module_id: string | null;
  result: LoopResult | null;
  error: string | null;
}

export const api = {
  health: () => request<Health>('/health'),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  run: (id: string) => request<Run>(`/runs/${id}`),
  lineage: (id: string) => request<Run[]>(`/runs/${id}/lineage`),
  exportUrl: (id: string) => `${API_BASE}/runs/${id}/export`,
  modules: () => request<ModuleOption[]>('/modules'),
  generate: (body: {
    asin: string;
    module_id: string;
    brief: string;
    demo_violation?: 'pricing' | 'safe_zone' | null;
  }) => post<{ job_id: string; status: string }>('/generate', body),
  stats: () => request<Stats>('/gallery/stats'),
  asins: () => request<{ count: number; items: AsinListItem[] }>('/asins'),
  asinReport: (asin: string) => request<AsinReport>(`/asin/${encodeURIComponent(asin)}/report`),
  reviewQueue: () => request<Run[]>('/review?limit=100'),
  review: (id: string, decision: 'approved' | 'rejected') =>
    patch<{ run_id: string; status: string }>(`/runs/${id}/review`, { decision }),
  verify: async (payload: { file?: File; run_id?: string }) => {
    const form = new FormData();
    if (payload.file) form.append('file', payload.file);
    if (payload.run_id) form.append('run_id', payload.run_id);
    const res = await fetch(`${API_BASE}/verify`, { method: 'POST', body: form });
    if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
    return (await res.json()) as VerifyResult;
  },
  gallery: (opts: { limit?: number; view?: string; asin?: string; module_id?: string; status?: string } = {}) => {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 120) });
    (['view', 'asin', 'module_id', 'status'] as const).forEach((k) => {
      if (opts[k]) q.set(k, opts[k] as string);
    });
    return request<{ view: string; count: number; items: Run[] }>(`/gallery?${q}`);
  },
};

/** Asset URLs come back API-relative (/asset?key=…) because the B2 bucket is
 *  private and proxied; resolve them against the API host. */
export function assetSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

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
