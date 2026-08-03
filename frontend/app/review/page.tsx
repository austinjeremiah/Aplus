'use client';

/**
 * Human-in-the-loop review queue.
 *
 * Holds two things that both need a person: assets the rubric rejected, and
 * assets it could not fully audit because the judge was unreachable. The
 * second category is why `needs_review` exists as a distinct status — silently
 * passing an unaudited image would be the worst thing this system could do.
 */

import type { CellStyle, ColDef } from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/app/AppShell';
import DataTable, { monoCell } from '@/components/app/DataTable';
import { ApiError, MODULE_LABELS, api, assetSrc, type Run } from '@/lib/api';

const ROW_HEIGHT = 96;

// Annotated rather than inlined: TypeScript unions the column literals and
// normalises the result with `display?: undefined`, which CellStyle's
// `[key: string]: string | number` index signature then rejects.
const CENTRED: CellStyle = { display: 'flex', alignItems: 'center' };
const PROVIDER_CELL: CellStyle = { ...monoCell, opacity: 0.7 };

/** The rule that actually blocked the asset, with the judge's quoted evidence. */
function violationOf(run: Run): { rule: string; evidence: string } {
  const err = (run.violations ?? []).find((v) => v.severity === 'error');
  if (err) return { rule: err.rule.replace(/_/g, ' '), evidence: err.evidence };
  return { rule: 'not audited', evidence: run.compliance?.notes || 'Could not be fully audited.' };
}

export default function ReviewPage() {
  const [rows, setRows] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .reviewQueue()
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e: ApiError) => {
        setError(e.message);
        setRows([]);
      });
  }, []);

  useEffect(load, [load]);

  const decide = useCallback(
    async (run: Run, decision: 'approved' | 'rejected') => {
      let restore: Run[] = [];
      // Optimistic: drop it from the queue immediately, restore if the call fails.
      setRows((before) => {
        restore = before ?? [];
        return restore.filter((r) => r.run_id !== run.run_id);
      });
      try {
        await api.review(run.run_id, decision);
        setToast(`${run.asin} ${decision}`);
      } catch (e) {
        setRows(restore);
        setToast(`Couldn't save — ${e instanceof ApiError ? e.message : String(e)}`);
      }
      setTimeout(() => setToast(null), 2800);
    },
    [],
  );

  const columns = useMemo<ColDef<Run>[]>(
    () => [
      {
        headerName: '',
        maxWidth: 96,
        sortable: false,
        cellStyle: CENTRED,
        cellRenderer: (p: { data: Run }) => (
          <Link href={`/runs/${p.data.run_id}`}>
            {p.data.asset_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetSrc(p.data.asset_url)} alt="" className="app_thumb" loading="lazy" />
            ) : (
              <div className="app_thumb" />
            )}
          </Link>
        ),
      },
      {
        field: 'asin',
        headerName: 'ASIN',
        flex: 1.4,
        minWidth: 180,
        cellRenderer: (p: { data: Run }) => (
          <div style={{ lineHeight: 1.45 }}>
            <Link href={`/runs/${p.data.run_id}`} style={{ fontFamily: 'Suisse Mono, monospace', fontSize: 13 }}>
              {p.data.asin}
            </Link>
            <div style={{ opacity: 0.5, fontSize: 12 }}>
              {MODULE_LABELS[p.data.module_id] ?? p.data.module_id}
            </div>
          </div>
        ),
      },
      {
        field: 'provider',
        headerName: 'Provider',
        flex: 1,
        minWidth: 150,
        // Was rendered at 0.32 opacity and effectively unreadable on black.
        cellStyle: PROVIDER_CELL,
        valueFormatter: (p) => p.value ?? '—',
      },
      {
        headerName: 'Why it stopped',
        flex: 3,
        minWidth: 300,
        sortable: false,
        valueGetter: (p) => (p.data ? violationOf(p.data).rule : ''),
        cellRenderer: (p: { data: Run }) => {
          const v = violationOf(p.data);
          return (
            <div style={{ lineHeight: 1.45, paddingTop: 2 }}>
              <div
                className="u-text-mono"
                style={{ fontSize: 11, color: '#f0736a', letterSpacing: '0.04em' }}
              >
                {v.rule.toUpperCase()}
              </div>
              {/* Clamped to two lines rather than truncated mid-word by the
                  cell edge; the run page carries the full text. */}
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.8,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
                title={v.evidence}
              >
                {v.evidence}
              </div>
            </div>
          );
        },
      },
      {
        headerName: '',
        flex: 1.2,
        minWidth: 210,
        sortable: false,
        cellStyle: CENTRED,
        cellRenderer: (p: { data: Run }) => (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: 13 }}>
            <button onClick={() => decide(p.data, 'approved')} style={{ color: '#6dd39a' }}>
              Approve
            </button>
            <button onClick={() => decide(p.data, 'rejected')} style={{ color: '#f0736a' }}>
              Reject
            </button>
            <Link
              href={`/generate?asin=${encodeURIComponent(p.data.asin)}&module_id=${p.data.module_id}`}
              style={{ opacity: 0.5 }}
            >
              Regenerate
            </Link>
          </div>
        ),
      },
    ],
    [decide],
  );

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            COMPLIANCE
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            Review queue
          </h1>
          <p className="u-text-style-small u-max-width-60ch" style={{ opacity: 0.5, marginTop: '0.7rem' }}>
            Assets the rubric rejected, plus any it couldn&rsquo;t fully audit. Your decision is
            recorded alongside the machine verdict, never over it.
          </p>
        </div>
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">ERROR</div>
          <div className="u-text-style-small">{error}</div>
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        emptyMessage="Nothing needs review"
        gridOptions={{ rowHeight: ROW_HEIGHT }}
      />

      {toast ? <div className="app_toast u-text-style-small">{toast}</div> : null}
    </AppShell>
  );
}
