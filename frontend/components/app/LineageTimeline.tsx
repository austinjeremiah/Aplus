'use client';

/**
 * The attempt chain, rendered once and reused by Run Detail and Verify.
 *
 * Failed provider attempts are shown, not filtered out — "GMICloud 402'd so we
 * fell through to Cloudflare" is the reliability evidence this whole system
 * exists to capture, and hiding it would leave only a tidy success story.
 */

import type { Run } from '@/lib/api';
import { assetSrc, money, shortId } from '@/lib/api';
import { StatusBadge, Violations } from './Bits';

export default function LineageTimeline({ entries }: { entries: Run[] }) {
  if (!entries.length) {
    return (
      <p className="u-text-style-main" style={{ opacity: 0.5 }}>
        No attempts recorded.
      </p>
    );
  }

  return (
    <div className="app_timeline">
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        const failed = !e.succeeded || e.status === 'failed' || e.status === 'rejected';
        const colour = failed ? '#ef6a5f' : e.status === 'needs_review' ? '#e2b04a' : '#5fd08a';

        return (
          <div className="app_timeline_item" key={e.run_id}>
            <div className="app_timeline_rail" style={{ color: colour }}>
              <div className={`app_timeline_node ${failed ? '' : 'is-filled'}`} />
              {!last ? <div className="app_timeline_line" /> : null}
            </div>

            <div className="app_timeline_body">
              <div className="app_row" style={{ justifyContent: 'space-between' }}>
                <div className="app_row">
                  <span className="u-text-style-h6 u-text-trim-off">v{e.version ?? e.attempt}</span>
                  <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.6 }}>
                    {e.provider ?? 'unknown'}
                    {e.model ? ` · ${e.model}` : ''}
                  </span>
                </div>
                <StatusBadge status={e.status} />
              </div>

              <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.4, marginTop: '0.35rem' }}>
                run {shortId(e.run_id)} · {money(e.cost_usd)}
                {e.duration_sec ? ` · ${e.duration_sec.toFixed(1)}s` : ''}
                {e.parent_run_id ? ` · supersedes ${shortId(e.parent_run_id)}` : ''}
              </div>

              {e.error ? (
                <div className="app_violation" style={{ color: '#ef6a5f' }}>
                  <div className="u-text-style-small">{e.error.slice(0, 240)}</div>
                </div>
              ) : null}

              <Violations items={e.violations ?? []} />

              {e.asset_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetSrc(e.asset_url)} alt={`attempt ${e.version ?? e.attempt}`} className="app_timeline_media" loading="lazy" />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
