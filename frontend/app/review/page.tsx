'use client';

/**
 * Human-in-the-loop review queue.
 *
 * Holds two things that both need a person: assets the rubric rejected, and
 * assets it could not fully audit because the judge was unreachable. The
 * second category is why `needs_review` exists as a distinct status — silently
 * passing an unaudited image would be the worst thing this system could do.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/app/AppShell';
import { ApiError, MODULE_LABELS, api, assetSrc, type Run } from '@/lib/api';

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

  async function decide(run: Run, decision: 'approved' | 'rejected') {
    const before = rows ?? [];
    // Optimistic: drop it from the queue immediately, restore if the call fails.
    setRows(before.filter((r) => r.run_id !== run.run_id));
    try {
      await api.review(run.run_id, decision);
      setToast(`${run.asin} ${decision}`);
    } catch (e) {
      setRows(before);
      setToast(`Couldn't save — ${e instanceof ApiError ? e.message : String(e)}`);
    }
    setTimeout(() => setToast(null), 2800);
  }

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

      {rows === null ? (
        <div className="app_panel">
          {[0, 1, 2].map((i) => (
            <div key={i} className="app_skeleton" style={{ height: '3rem', marginBottom: '0.8rem' }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="app_empty">
          <div className="u-text-style-h5 u-text-trim-off">Nothing needs review</div>
          <p className="u-text-style-main" style={{ opacity: 0.5, maxWidth: '38ch', margin: '0.9rem auto 0' }}>
            Every generated asset either passed the rubric or has already been decided on.
          </p>
        </div>
      ) : (
        <div className="app_panel is-flush">
          <table className="app_table u-text-style-small">
            <tbody>
              {rows.map((r) => {
                const errs = (r.violations ?? []).filter((v) => v.severity === 'error');
                return (
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
                    <td style={{ minWidth: '9rem' }}>
                      <Link href={`/runs/${r.run_id}`}>{r.asin}</Link>
                      <div className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
                        {MODULE_LABELS[r.module_id] ?? r.module_id}
                      </div>
                      <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.32 }}>
                        {r.provider ?? '—'}
                      </div>
                    </td>
                    <td style={{ maxWidth: '26rem' }}>
                      {errs.length ? (
                        <ul className="app_violations" style={{ margin: 0 }}>
                          {errs.map((v, i) => (
                            <li key={i}>
                              <span className="u-text-mono u-text-style-xsmall">
                                {v.rule.replace(/_/g, ' ')}
                              </span>
                              <span className="u-text-style-small">{v.evidence}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="u-text-style-small" style={{ opacity: 0.45 }}>
                          {r.compliance?.notes || 'Could not be fully audited.'}
                        </span>
                      )}
                    </td>
                    <td style={{ width: '15rem' }}>
                      <div className="app_row" style={{ gap: '1rem' }}>
                        <button
                          onClick={() => decide(r, 'approved')}
                          className="u-text-style-small"
                          style={{ color: '#6dd39a', textDecoration: 'underline' }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => decide(r, 'rejected')}
                          className="u-text-style-small"
                          style={{ color: '#f0736a', textDecoration: 'underline' }}
                        >
                          Reject
                        </button>
                        <Link
                          href={`/generate?asin=${encodeURIComponent(r.asin)}&module_id=${r.module_id}`}
                          className="u-text-style-small"
                          style={{ opacity: 0.5, textDecoration: 'underline' }}
                        >
                          Regenerate
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast ? <div className="app_toast u-text-style-small">{toast}</div> : null}
    </AppShell>
  );
}
