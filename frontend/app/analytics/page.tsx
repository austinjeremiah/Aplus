'use client';

/**
 * Cost and reliability, read from the Parquet run index every pipeline
 * execution writes alongside its manifest.
 *
 * Pass rate counts only attempts that reached the rubric. A provider that
 * returned an error has no pass rate, because "breaks Amazon's rules" and
 * "the endpoint was down" are different failures with different fixes.
 */

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/app/AppShell';
import { ApiError, api, money, type Stats } from '@/lib/api';

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

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.stats().then(setStats).catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const maxAttempts = Math.max(...(stats?.per_provider ?? []).map((p) => p.attempts), 1);
  const maxCost = Math.max(...(stats?.cost_per_asin ?? []).map((c) => c.cost_usd), 0.0001);

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            ANALYTICS
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            Cost &amp; reliability
          </h1>
          <p className="u-text-style-small u-max-width-60ch" style={{ opacity: 0.5, marginTop: '0.7rem' }}>
            Queried from the Parquet run index that every pipeline execution writes alongside
            its manifest in B2.
          </p>
        </div>
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">ERROR</div>
          <div className="u-text-style-small">{error}</div>
        </div>
      ) : null}

      <div className="app_grid_stats">
        {stats ? (
          <>
            <Stat label="TOTAL RUNS" value={stats.total_runs} />
            <Stat label="ASINS" value={stats.total_asins} />
            <Stat label="TOTAL SPEND" value={money(stats.total_cost_usd)} hint="across every attempt" />
            <Stat
              label="PASS RATE"
              value={stats.overall_pass_rate == null ? '—' : `${Math.round(stats.overall_pass_rate * 100)}%`}
              hint="of judged attempts"
            />
            <Stat label="ATTEMPTS / JOB" value={stats.avg_attempts_per_job ?? '—'} hint="incl. fallbacks" />
          </>
        ) : (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="app_skeleton" style={{ height: '7rem' }} />
          ))
        )}
      </div>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Provider reliability</h2>
        <p className="u-text-style-small" style={{ opacity: 0.45, margin: '0.6rem 0 1.5rem' }}>
          Pass rate counts only attempts that reached the rubric — an outage is never mistaken
          for a policy failure.
        </p>
        <div className="app_panel is-flush">
          <table className="app_table u-text-style-small">
            <thead>
              <tr className="u-text-mono u-text-style-xsmall">
                <th>Provider</th>
                <th style={{ minWidth: '10rem' }}>Attempts</th>
                <th>Passed</th>
                <th>Rejected</th>
                <th>Errors</th>
                <th>Pass rate</th>
                <th>Spend</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.per_provider ?? []).map((p) => (
                <tr key={p.provider}>
                  <td className="u-text-mono">{p.provider}</td>
                  <td>
                    <div className="app_row" style={{ flexWrap: 'nowrap', gap: '0.7rem' }}>
                      <span style={{ minWidth: '1.5rem' }}>{p.attempts}</span>
                      <span className="app_bar">
                        <span style={{ width: `${(p.attempts / maxAttempts) * 100}%` }} />
                      </span>
                    </div>
                  </td>
                  <td style={{ color: '#6dd39a' }}>{p.passed}</td>
                  <td style={{ color: '#f0736a' }}>{p.failed}</td>
                  <td style={{ color: p.errors ? '#e5b552' : 'inherit' }}>{p.errors}</td>
                  <td>
                    {p.pass_rate == null ? (
                      <span style={{ opacity: 0.35 }}>never judged</span>
                    ) : (
                      `${Math.round(p.pass_rate * 100)}%`
                    )}
                  </td>
                  <td>{money(p.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Cost per ASIN</h2>
        <div className="app_panel" style={{ marginTop: '1.4rem' }}>
          {(stats?.cost_per_asin ?? []).slice(0, 12).map((c) => (
            <div className="app_row" key={c.asin} style={{ flexWrap: 'nowrap', padding: '0.5rem 0' }}>
              <span className="u-text-mono u-text-style-xsmall" style={{ minWidth: '8rem' }}>
                {c.asin}
              </span>
              <span className="app_bar" style={{ flex: 1 }}>
                <span style={{ width: `${(c.cost_usd / maxCost) * 100}%` }} />
              </span>
              <span className="u-text-mono u-text-style-xsmall" style={{ minWidth: '4rem', textAlign: 'right' }}>
                {money(c.cost_usd)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Outcomes</h2>
        <div className="app_grid_stats" style={{ marginTop: '1.4rem' }}>
          {Object.entries(stats?.status_counts ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, ' ').toUpperCase()} value={v} />
            ))}
        </div>
      </section>
    </AppShell>
  );
}
