'use client';

/**
 * Human-in-the-loop review queue.
 *
 * Holds two different things that both need a person: assets the rubric
 * rejected, and assets it could not fully audit (judge unreachable). The
 * second category is why `needs_review` exists as a distinct status — silently
 * passing an unaudited image would be the worst thing this system could do.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
 api,
 assetSrc, ApiError, MODULE_LABELS, shortId, type Run } from '@/lib/api';
import { ComplianceBadge, Empty, ErrorBox, PageHead, Skeleton, StatusBadge, Violations } from '@/components/app/Bits';

export default function ReviewPage() {
  const [rows, setRows] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.reviewQueue());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(run: Run, decision: 'approved' | 'rejected') {
    const before = rows ?? [];
    // Optimistic: drop it from the queue immediately, restore on failure.
    setRows(before.filter((r) => r.run_id !== run.run_id));
    try {
      await api.review(run.run_id, decision);
      setToast(`${shortId(run.run_id)} ${decision}`);
      setTimeout(() => setToast(null), 2600);
    } catch (e) {
      setRows(before);
      setToast(`Could not save — ${e instanceof ApiError ? e.message : String(e)}`);
      setTimeout(() => setToast(null), 4000);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Compliance"
        title="Review queue"
        lede="Assets the rubric rejected, plus any it could not fully audit. A machine verdict is never overwritten — your decision is recorded alongside it."
      />

      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {rows === null ? (
        <div className="app_panel">
          <Skeleton h="3rem" />
          <div style={{ height: '0.75rem' }} />
          <Skeleton h="3rem" />
          <div style={{ height: '0.75rem' }} />
          <Skeleton h="3rem" />
        </div>
      ) : rows.length === 0 ? (
        <Empty
          title="Nothing needs review"
          body="Every generated asset either passed the rubric or has already been decided on."
        />
      ) : (
        <div className="app_panel is-flush">
          <table className="app_table u-text-style-small">
            <thead>
              <tr className="u-text-mono u-text-style-xsmall">
                <th style={{ width: '5.5rem' }}>Asset</th>
                <th>ASIN / module</th>
                <th>Verdict</th>
                <th>Why</th>
                <th style={{ width: '13rem' }}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.run_id}>
                  <td>
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
                    <Link href={`/runs/${r.run_id}`} className="u-text-style-small">
                      {r.asin}
                    </Link>
                    <div className="u-text-style-xsmall" style={{ opacity: 0.5 }}>
                      {MODULE_LABELS[r.module_id] ?? r.module_id}
                    </div>
                    <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.35 }}>
                      {r.provider ?? '—'}
                    </div>
                  </td>
                  <td>
                    <div className="app_stack">
                      <StatusBadge status={r.status} />
                      <ComplianceBadge compliance={r.compliance} />
                    </div>
                  </td>
                  <td style={{ maxWidth: '22rem' }}>
                    {r.violations?.length ? (
                      <Violations items={r.violations} />
                    ) : (
                      <span className="u-text-style-small" style={{ opacity: 0.5 }}>
                        {r.compliance?.notes || 'No specific violation recorded.'}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="app_row">
                      <button
                        onClick={() => decide(r, 'approved')}
                        className="u-text-style-small"
                        style={{ color: '#5fd08a', textDecoration: 'underline' }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => decide(r, 'rejected')}
                        className="u-text-style-small"
                        style={{ color: '#ef6a5f', textDecoration: 'underline' }}
                      >
                        Reject
                      </button>
                      <Link
                        href={`/generate?asin=${encodeURIComponent(r.asin)}&module_id=${r.module_id}`}
                        className="u-text-style-small"
                        style={{ opacity: 0.6, textDecoration: 'underline' }}
                      >
                        Regenerate
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast ? <div className="app_toast u-text-style-small">{toast}</div> : null}
    </>
  );
}
