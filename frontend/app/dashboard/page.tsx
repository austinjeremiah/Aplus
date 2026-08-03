'use client';

/**
 * Dashboard — the opening view once signed in.
 *
 * Each panel loads independently so one failing endpoint degrades a single
 * card instead of blanking the page.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/app/AppShell';
import {
  ApiError,
  MODULE_LABELS,
  api,
  assetSrc,
  money,
  type Health,
  type Run,
  type Stats,
} from '@/lib/api';

/* --- small presentational bits ---------------------------------------- */

const TONE: Record<string, string> = {
  passed: 'is-pass',
  approved: 'is-pass',
  needs_review: 'is-warn',
  failed: 'is-fail',
  rejected: 'is-fail',
  provider_failed: 'is-fail',
  generated: 'is-idle',
};

const LABEL: Record<string, string> = {
  passed: 'Compliant',
  approved: 'Approved',
  needs_review: 'Needs review',
  failed: 'Rejected',
  rejected: 'Rejected',
  provider_failed: 'Provider failed',
  generated: 'Generated',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`app_badge ${TONE[status] ?? 'is-idle'} u-text-mono u-text-style-xsmall`}>
      <span className="app_badge_dot" />
      {LABEL[status] ?? status}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="app_stat">
      <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
        {label}
      </div>
      <div className="u-text-style-h3 u-text-trim-off app_stat_value">{value}</div>
      {hint ? (
        <div className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Skeleton({ h }: { h: string }) {
  return <div className="app_skeleton" style={{ height: h }} />;
}

/* --- page -------------------------------------------------------------- */

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.stats().then(setStats).catch((e: ApiError) => setError(e.message));
    api.gallery(8).then((g) => setRuns(g.items)).catch(() => setRuns([]));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(load, [load]);

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            OVERVIEW
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            Compliance dashboard
          </h1>
        </div>
        <Link href="/generate" data-btn-default="" className="g_btn_main w-inline-block">
          <div className="g_btn_text_contain">
            <div className="g_btn_text u-text-style-small u-text-trim-off">New generation</div>
          </div>
          <div className="g_btn_aside_wrap">
            <div className="g_btn_aside_bg" />
            <svg width="100%" viewBox="0 0 12 12" fill="none" className="g_btn_svg" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M8.90954 9.09046L9 3L2.90954 3.09046L2.90213 4.32367L6.86437 4.25391L2.55914 8.55914L3.44086 9.44086L7.74609 5.13563L7.68708 9.10862L8.90954 9.09046Z"
                fill="currentColor"
              />
            </svg>
          </div>
        </Link>
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">BACKEND UNREACHABLE</div>
          <div className="u-text-style-main">{error}</div>
          <button onClick={load} className="u-text-style-small" style={{ marginTop: '0.6rem', textDecoration: 'underline' }}>
            Retry
          </button>
        </div>
      ) : null}

      {/* --- headline numbers --- */}
      <div className="app_grid_stats">
        {stats ? (
          <>
            <Stat label="ASINS TRACKED" value={stats.total_asins} />
            <Stat label="TOTAL RUNS" value={stats.total_runs} hint="every attempt, including failures" />
            <Stat
              label="PASS RATE"
              value={stats.overall_pass_rate == null ? '—' : `${Math.round(stats.overall_pass_rate * 100)}%`}
              hint="of attempts the rubric judged"
            />
            <Stat label="TOTAL SPEND" value={money(stats.total_cost_usd)} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h="7rem" />)
        )}
      </div>

      <div className="app_grid_split app_section">
        {/* --- recent runs --- */}
        <section>
          <div className="app_row" style={{ justifyContent: 'space-between', marginBottom: '1.2rem' }}>
            <h2 className="u-text-style-h4 u-text-trim-off">Recent runs</h2>
            <Link href="/gallery" className="u-text-style-small" style={{ opacity: 0.5, textDecoration: 'underline' }}>
              View all
            </Link>
          </div>

          {runs === null ? (
            <div className="app_panel">
              <Skeleton h="2.6rem" />
              <div style={{ height: '0.7rem' }} />
              <Skeleton h="2.6rem" />
              <div style={{ height: '0.7rem' }} />
              <Skeleton h="2.6rem" />
            </div>
          ) : runs.length === 0 ? (
            <div className="app_empty">
              <div className="u-text-style-h5 u-text-trim-off">No runs yet</div>
              <p className="u-text-style-main" style={{ opacity: 0.5, maxWidth: '34ch', margin: '0.8rem auto 0' }}>
                Start a generation and the pipeline will take it from brief to verified asset.
              </p>
            </div>
          ) : (
            <div className="app_panel is-flush">
              <table className="app_table u-text-style-small">
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.run_id}>
                      <td style={{ width: '5rem' }}>
                        <Link href={`/runs/${r.run_id}`}>
                          {r.asset_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={assetSrc(r.asset_url)} alt="" className="app_thumb" loading="lazy" />
                          ) : (
                            <div className="app_thumb" />
                          )}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/runs/${r.run_id}`} className="u-text-style-small">
                          {r.asin}
                        </Link>
                        <div className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
                          {MODULE_LABELS[r.module_id] ?? r.module_id}
                        </div>
                      </td>
                      <td className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.45 }}>
                        {r.provider ?? '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* --- compliance breakdown --- */}
        <aside>
          <h2 className="u-text-style-h4 u-text-trim-off" style={{ marginBottom: '1.2rem' }}>
            Compliance
          </h2>
          <div className="app_panel">
            {stats ? (
              <>
                {(() => {
                  const c = stats.status_counts ?? {};
                  const passed = (c.passed ?? 0) + (c.approved ?? 0);
                  const rejected = (c.failed ?? 0) + (c.rejected ?? 0);
                  const review = c.needs_review ?? 0;
                  const total = passed + rejected + review || 1;
                  const bars = [
                    { label: 'Compliant', n: passed, hue: '#6dd39a' },
                    { label: 'Rejected by rubric', n: rejected, hue: '#f0736a' },
                    { label: 'Needs human review', n: review, hue: '#e5b552' },
                  ];
                  return bars.map((b) => (
                    <div key={b.label} style={{ marginBottom: '1.1rem' }}>
                      <div className="app_row" style={{ justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                        <span className="u-text-style-small u-text-trim-off">{b.label}</span>
                        <span className="u-text-mono u-text-style-xsmall" style={{ color: b.hue }}>
                          {b.n}
                        </span>
                      </div>
                      <div style={{ height: '0.4rem', borderRadius: 999, background: 'var(--swatch--black-300)' }}>
                        <div
                          style={{
                            width: `${(b.n / total) * 100}%`,
                            height: '100%',
                            borderRadius: 999,
                            background: b.hue,
                          }}
                        />
                      </div>
                    </div>
                  ));
                })()}

                <div style={{ borderTop: '1px solid var(--swatch--black-300)', marginTop: '1.4rem', paddingTop: '1.1rem' }}>
                  <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.4, marginBottom: '0.5rem' }}>
                    JUDGED BY
                  </div>
                  <div className="u-text-style-small u-text-trim-off app_break">
                    {health?.config.compliance_judge ?? '—'}
                  </div>
                  <p className="u-text-style-xsmall" style={{ opacity: 0.42, marginTop: '0.7rem' }}>
                    Dimensions, colour mode and file size are checked deterministically.
                    Pricing claims, competitor marks and the mobile safe zone are read
                    from the image itself, with the offending text quoted as evidence.
                  </p>
                </div>
              </>
            ) : (
              <Skeleton h="14rem" />
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
