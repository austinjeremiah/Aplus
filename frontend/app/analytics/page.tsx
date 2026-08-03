'use client';

/**
 * Cost and reliability, read from the Parquet run index every pipeline
 * execution writes alongside its manifest.
 *
 * Pass rate counts only attempts that reached the rubric. A provider that
 * returned an error has no pass rate, because "breaks Amazon's rules" and
 * "the endpoint was down" are different failures with different fixes.
 */

import type { ColDef } from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/app/AppShell';
import DataTable, { monoCell } from '@/components/app/DataTable';
import { ApiError, api, money, type Stats } from '@/lib/api';

type ProviderRow = Stats['per_provider'][number];
type AsinRow = Stats['cost_per_asin'][number];

const PASS = '#6dd39a';
const FAIL = '#f0736a';
const WARN = '#e5b552';

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

/** Zero counts are dimmed so a non-zero one is findable by eye alone. */
function count(colour: string) {
  return (p: { value: number }) => (
    <span style={{ color: p.value ? colour : 'inherit', opacity: p.value ? 1 : 0.25 }}>{p.value}</span>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.stats().then(setStats).catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const providerCols = useMemo<ColDef<ProviderRow>[]>(
    () => [
      { field: 'provider', headerName: 'Provider', flex: 2, minWidth: 190, cellStyle: monoCell },
      { field: 'attempts', headerName: 'Attempts', maxWidth: 130 },
      { field: 'passed', headerName: 'Passed', maxWidth: 120, cellRenderer: count(PASS) },
      { field: 'failed', headerName: 'Rejected', maxWidth: 130, cellRenderer: count(FAIL) },
      { field: 'errors', headerName: 'Errors', maxWidth: 120, cellRenderer: count(WARN) },
      {
        field: 'pass_rate',
        headerName: 'Pass rate',
        maxWidth: 150,
        // Null is not zero here: it means the provider never reached the
        // rubric at all, so a percentage would be a fabricated verdict.
        cellRenderer: (p: { value: number | null }) =>
          p.value == null ? (
            <span style={{ opacity: 0.3 }}>never judged</span>
          ) : (
            `${Math.round(p.value * 100)}%`
          ),
      },
      {
        field: 'cost_usd',
        headerName: 'Spend',
        maxWidth: 130,
        cellRenderer: (p: { value: number }) => money(p.value),
      },
    ],
    [],
  );

  const asinCols = useMemo<ColDef<AsinRow>[]>(
    () => [
      { field: 'asin', headerName: 'ASIN', flex: 2, minWidth: 170, cellStyle: monoCell },
      {
        field: 'cost_usd',
        headerName: 'Spend',
        maxWidth: 160,
        cellRenderer: (p: { value: number }) => money(p.value),
      },
    ],
    [],
  );

  const freeChain = !!stats && stats.total_cost_usd === 0 && stats.total_runs > 0;

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
            <Stat
              label="TOTAL SPEND"
              value={money(stats.total_cost_usd)}
              hint={freeChain ? 'entire chain is free-tier' : 'across every attempt'}
            />
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
        <p className="u-text-style-small u-max-width-60ch" style={{ opacity: 0.45, margin: '0.6rem 0 1.5rem' }}>
          Pass rate counts only attempts that reached the rubric — an outage is never mistaken
          for a policy failure. Sort any column to compare.
        </p>
        <DataTable
          rows={stats?.per_provider ?? null}
          columns={providerCols}
          emptyMessage="No provider attempts recorded yet"
        />
      </section>

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Spend by ASIN</h2>
        <p className="u-text-style-small u-max-width-60ch" style={{ opacity: 0.45, margin: '0.6rem 0 1.5rem' }}>
          {freeChain
            ? 'Every provider currently in the chain runs on a free tier, so real metered spend is $0.00 — the column is populated from what each provider actually reported, not estimated, so a paid provider entering the chain shows up here immediately.'
            : 'Metered from what each provider reported on the attempt, summed across every retry for that ASIN.'}
        </p>
        <DataTable
          rows={stats?.cost_per_asin ?? null}
          columns={asinCols}
          emptyMessage="No spend recorded yet"
          height={360}
        />
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
