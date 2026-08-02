'use client';

/**
 * Dashboard — the demo opener.
 *
 * Loads its panels independently so a single failing endpoint degrades one
 * card rather than blanking the page.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
 api,
 assetSrc, ApiError, MODULE_LABELS, money, type Health, type Run, type Stats } from '@/lib/api';
import { ButtonLink, Empty, ErrorBox, PageHead, Skeleton, Stat, StatusBadge } from '@/components/app/Bits';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Run[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [recentErr, setRecentErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.stats().then(setStats).catch((e: ApiError) => setStatsErr(e.message));
    api
      .gallery({})
      .then((g) => setRecent(g.items.slice(0, 8)))
      .catch((e: ApiError) => setRecentErr(e.message));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <PageHead
        eyebrow="A++"
        title="Compliance dashboard"
        lede="A production system around Amazon A+ Content generation: a real rubric, multi-provider fallback with full lineage, and verifiable provenance for every asset."
        actions={<ButtonLink href="/generate">New generation</ButtonLink>}
      />

      {statsErr ? <ErrorBox message={statsErr} onRetry={load} /> : null}

      <div className="app_grid is-stats">
        {stats ? (
          <>
            <Stat label="ASINs tracked" value={stats.total_asins} />
            <Stat label="Total runs" value={stats.total_runs} />
            <Stat
              label="Pass rate"
              value={stats.overall_pass_rate == null ? '—' : `${Math.round(stats.overall_pass_rate * 100)}%`}
              hint="of judged attempts"
            />
            <Stat label="Total spend" value={money(stats.total_cost_usd)} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h="6rem" />)
        )}
      </div>

      <div className="app_grid is-split app_section">
        <section>
          <div className="app_row" style={{ justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 className="u-text-style-h4 u-text-trim-off">Recent runs</h2>
            <Link href="/gallery" className="u-text-style-small" style={{ opacity: 0.6, textDecoration: 'underline' }}>
              View all
            </Link>
          </div>

          {recentErr ? <ErrorBox message={recentErr} onRetry={load} /> : null}

          {recent === null ? (
            <div className="app_panel">
              <Skeleton h="2.5rem" />
              <div style={{ height: '0.6rem' }} />
              <Skeleton h="2.5rem" />
              <div style={{ height: '0.6rem' }} />
              <Skeleton h="2.5rem" />
            </div>
          ) : recent.length === 0 ? (
            <Empty
              title="No runs yet"
              body="Start your first generation and the pipeline will take it from brief to verified asset."
              action={<ButtonLink href="/generate">New generation</ButtonLink>}
            />
          ) : (
            <div className="app_panel is-flush">
              <table className="app_table u-text-style-small">
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.run_id}>
                      <td style={{ width: '5.5rem' }}>
                        <Link href={`/runs/${r.run_id}`}>
                          {r.asset_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={assetSrc(r.asset_url)} alt="" className="app_table_thumb" loading="lazy" />
                          ) : (
                            <div className="app_table_thumb" />
                          )}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/runs/${r.run_id}`}>{r.asin}</Link>
                        <div className="u-text-style-xsmall" style={{ opacity: 0.5 }}>
                          {MODULE_LABELS[r.module_id] ?? r.module_id}
                        </div>
                      </td>
                      <td className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
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

        <aside>
          <h2 className="u-text-style-h4 u-text-trim-off" style={{ marginBottom: '1.25rem' }}>
            Provider chain
          </h2>
          <div className="app_panel">
            {health ? (
              <>
                {health.providers.map((p) => {
                  const dead = p.status !== 'ready';
                  return (
                    <div
                      key={`${p.provider}-${p.position}`}
                      className="app_row"
                      style={{ justifyContent: 'space-between', padding: '0.55rem 0', opacity: dead ? 0.45 : 1 }}
                    >
                      <div className="app_stack" style={{ gap: '0.15rem' }}>
                        <span className="u-text-style-small">
                          {p.position + 1}. {p.provider}
                        </span>
                        <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
                          {p.model}
                        </span>
                      </div>
                      <span
                        className="u-text-mono u-text-style-xsmall"
                        style={{ color: dead ? '#ef6a5f' : '#5fd08a', textAlign: 'right' }}
                      >
                        {dead ? p.status : p.role}
                      </span>
                    </div>
                  );
                })}
                <div style={{ borderTop: '1px solid var(--_theme---border)', marginTop: '1rem', paddingTop: '1rem' }}>
                  {Object.entries(health.config).map(([k, v]) => (
                    <div key={k} className="app_row" style={{ justifyContent: 'space-between', padding: '0.25rem 0' }}>
                      <span className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
                        {k.replace(/_/g, ' ')}
                      </span>
                      <span className="u-text-mono u-text-style-xsmall app_mono_break" style={{ textAlign: 'right' }}>
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Skeleton h="12rem" />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
