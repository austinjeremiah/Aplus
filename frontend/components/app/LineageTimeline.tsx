'use client';

/**
 * The attempt chain behind one asset.
 *
 * Failed attempts are shown, not filtered out — "this was rejected for a
 * pricing claim, so it was regenerated" is the record this whole system exists
 * to keep. Reused by the run page and the public verify page so the two can't
 * describe the same history differently.
 */

import { assetSrc, money, type Run } from '@/lib/api';

function dot(status: string) {
  if (status === 'passed' || status === 'approved') return '#6dd39a';
  if (status === 'needs_review') return '#e5b552';
  return '#f0736a';
}

export default function LineageTimeline({ entries }: { entries: Run[] }) {
  if (!entries.length) {
    return (
      <p className="u-text-style-small" style={{ opacity: 0.45 }}>
        No attempts recorded.
      </p>
    );
  }

  return (
    <div className="app_timeline">
      {entries.map((e, i) => {
        const colour = dot(e.status);
        const last = i === entries.length - 1;
        const errors = (e.violations ?? []).filter((v) => v.severity === 'error');

        return (
          <div className="app_tl_item" key={e.run_id}>
            <div className="app_tl_rail" style={{ color: colour }}>
              <span className="app_tl_node" />
              {!last ? <span className="app_tl_line" /> : null}
            </div>

            <div className="app_tl_body">
              <div className="app_row" style={{ justifyContent: 'space-between' }}>
                <div className="app_row" style={{ gap: '0.7rem' }}>
                  <span className="u-text-style-h6 u-text-trim-off">v{e.version ?? e.attempt}</span>
                  <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
                    {e.provider ?? 'unknown'}
                  </span>
                </div>
                <span className="u-text-mono u-text-style-xsmall" style={{ color: colour }}>
                  {e.status === 'passed' || e.status === 'approved'
                    ? 'PASSED'
                    : e.status === 'needs_review'
                      ? 'NEEDS REVIEW'
                      : 'REJECTED'}
                </span>
              </div>

              <div
                className="u-text-mono u-text-style-xsmall"
                style={{ opacity: 0.35, marginTop: '0.45rem' }}
              >
                {money(e.cost_usd)}
                {e.duration_sec ? ` · ${e.duration_sec.toFixed(1)}s` : ''}
                {e.parent_run_id ? ` · supersedes ${e.parent_run_id.slice(0, 8)}` : ''}
              </div>

              {errors.length ? (
                <ul className="app_violations">
                  {errors.map((v, n) => (
                    <li key={`${v.rule}-${n}`}>
                      <span className="u-text-mono u-text-style-xsmall">
                        {v.rule.replace(/_/g, ' ')}
                      </span>
                      <span className="u-text-style-small">{v.evidence}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {e.asset_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetSrc(e.asset_url)}
                  alt={`attempt ${e.version ?? e.attempt}`}
                  className="app_tl_img"
                  loading="lazy"
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
