'use client';

/**
 * Cost and reliability analytics, read from the Parquet-backed run index.
 *
 * The provider table is the point of the page: it is the fallback story as
 * data rather than as a claim. Note that pass rate is computed over *judged*
 * attempts only — a provider that returned 402 seventeen times has no pass
 * rate, because "breaks Amazon's rules" and "endpoint was down" are different
 * failures with different fixes.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, money, type Stats } from '@/lib/api';
import { Empty, ErrorBox, PageHead, Skeleton, Stat } from '@/components/app/Bits';

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await api.stats());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <>
        <PageHead eyebrow="Analytics" title="Cost & reliability" />
        <ErrorBox message={error} onRetry={load} />
      </>
    );
  }

  if (!stats) {
    return (
      <>
        <PageHead eyebrow="Analytics" title="Cost & reliability" />
        <div className="app_grid is-stats">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} h="6rem" />
          ))}
        </div>
      </>
    );
  }

  if (stats.total_runs === 0) {
    return (
      <>
        <PageHead eyebrow="Analytics" title="Cost & reliability" />
        <Empty title="No data yet" body="Generate a few assets and this page will fill in." />
      </>
    );
  }

  const maxAsinCost = Math.max(...stats.cost_per_asin.map((c) => c.cost_usd), 0.0001);
  const maxAttempts = Math.max(...stats.per_provider.map((p) => p.attempts), 1);

  return (
    <>
      <PageHead
        eyebrow="Analytics"
        title="Cost & reliability"
        lede="Queried from the Parquet run index that every pipeline execution writes alongside its manifest."
      />

      <div className="app_grid is-stats">
        <Stat label="Total runs" value={stats.total_runs} />
        <Stat label="ASINs tracked" value={stats.total_asins} />
        <Stat label="Total spend" value={money(stats.total_cost_usd)} hint="across every attempt" />
        <Stat
          label="Compliance pass rate"
          value={stats.overall_pass_rate == null ? '—' : `${Math.round(stats.overall_pass_rate * 100)}%`}
          hint="of judged attempts"
        />
        <Stat
          label="Attempts per job"
          value={stats.avg_attempts_per_job ?? '—'}
          hint="incl. provider fallbacks"
        />
      </div>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Provider reliability</h2>
        <p className="u-text-style-small" style={{ opacity: 0.55, margin: '0.5rem 0 1.5rem' }}>
          Pass rate counts only attempts that reached the rubric. Provider errors are
          reported separately so an outage is never mistaken for a policy failure.
        </p>
        <div className="app_panel is-flush">
          <table className="app_table u-text-style-small">
            <thead>
              <tr className="u-text-mono u-text-style-xsmall">
                <th>Provider</th>
                <th>Attempts</th>
                <th>Passed</th>
                <th>Rejected</th>
                <th>Errors</th>
                <th>Pass rate</th>
                <th>Spend</th>
              </tr>
            </thead>
            <tbody>
              {stats.per_provider.map((p) => (
                <tr key={p.provider}>
                  <td className="u-text-mono">{p.provider}</td>
                  <td style={{ minWidth: '9rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ minWidth: '1.6rem' }}>{p.attempts}</span>
                      <div className="app_bar_track" style={{ flex: 1, minWidth: '4rem' }}>
                        <div className="app_bar_fill" style={{ width: `${(p.attempts / maxAttempts) * 100}%` }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ color: '#5fd08a' }}>{p.passed}</td>
                  <td style={{ color: '#ef6a5f' }}>{p.failed}</td>
                  <td style={{ color: p.errors ? '#e2b04a' : 'inherit' }}>{p.errors}</td>
                  <td>{p.pass_rate == null ? <span style={{ opacity: 0.4 }}>never judged</span> : `${Math.round(p.pass_rate * 100)}%`}</td>
                  <td>{money(p.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Cost per ASIN</h2>
        <div className="app_panel" style={{ marginTop: '1.5rem' }}>
          {stats.cost_per_asin.slice(0, 12).map((c) => (
            <div className="app_bar_row" key={c.asin}>
              <span className="u-text-mono u-text-style-xsmall">{c.asin}</span>
              <div className="app_bar_track">
                <div className="app_bar_fill" style={{ width: `${(c.cost_usd / maxAsinCost) * 100}%` }} />
              </div>
              <span className="app_bar_value u-text-mono u-text-style-xsmall">{money(c.cost_usd)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Run outcomes</h2>
        <div className="app_grid is-stats" style={{ marginTop: '1.5rem' }}>
          {Object.entries(stats.status_counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, ' ')} value={v} />
            ))}
        </div>
      </section>
    </>
  );
}
