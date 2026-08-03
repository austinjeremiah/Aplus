'use client';

/**
 * Asset gallery.
 *
 * The view toggle isn't a UI filter — it switches which B2 key layout the
 * assets are read through. "By ASIN" is the hierarchical run tree;
 * "Asset library" is the content-addressable tree, where byte-identical
 * outputs collapse onto one key.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/app/AppShell';
import { ApiError, MODULE_LABELS, api, assetSrc, type Run } from '@/lib/api';

const STATUSES = ['', 'passed', 'approved', 'failed', 'needs_review'];

const TONE: Record<string, string> = {
  passed: 'is-pass',
  approved: 'is-pass',
  needs_review: 'is-warn',
  failed: 'is-fail',
  rejected: 'is-fail',
};

export default function GalleryPage() {
  const [view, setView] = useState<'hierarchical' | 'dedup'>('hierarchical');
  const [asin, setAsin] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    api
      .gallery({ view, asin, module_id: moduleId, status })
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e: ApiError) => {
        setError(e.message);
        setItems([]);
      });
  }, [view, asin, moduleId, status]);

  useEffect(() => {
    const t = setTimeout(load, asin ? 350 : 0); // debounce the free-text field
    return () => clearTimeout(t);
  }, [load, asin]);

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            ASSETS
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            Gallery
          </h1>
        </div>
      </header>

      <div className="app_panel" style={{ marginBottom: '2rem' }}>
        <div className="app_row" style={{ justifyContent: 'space-between' }}>
          <div className="app_row" style={{ gap: '0.6rem' }}>
            {(
              [
                ['hierarchical', 'By ASIN'],
                ['dedup', 'Asset library'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="u-text-style-small app_toggle"
                data-active={view === v}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.38 }}>
            {view === 'hierarchical'
              ? 'b2://…/runs/{asin}/{date}/{run_id}/'
              : 'b2://…/assets/{ab}/{cd}/{sha256}'}
          </span>
        </div>

        <div className="app_row" style={{ marginTop: '1.3rem', flexWrap: 'nowrap' }}>
          <input
            className="app_input u-text-style-small"
            placeholder="Filter by ASIN"
            value={asin}
            onChange={(e) => setAsin(e.target.value)}
          />
          <select
            className="app_input u-text-style-small"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
          >
            <option value="">All modules</option>
            {Object.entries(MODULE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="app_input u-text-style-small"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">ERROR</div>
          <div className="u-text-style-small">{error}</div>
        </div>
      ) : null}

      {items === null ? (
        <div className="app_cards">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="app_skeleton" style={{ height: '13rem' }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="app_empty">
          <div className="u-text-style-h5 u-text-trim-off">No assets match these filters</div>
        </div>
      ) : (
        <>
          <p className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.4, marginBottom: '1rem' }}>
            {items.length} ASSET{items.length === 1 ? '' : 'S'}
          </p>
          <div className="app_cards">
            {items.map((r) => (
              <Link href={`/runs/${r.run_id}`} key={r.run_id} className="app_card">
                <div className="app_card_media">
                  {r.asset_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetSrc(r.asset_url)} alt={r.asin} loading="lazy" />
                  ) : null}
                </div>
                <div className="app_card_body">
                  <div className="app_row" style={{ justifyContent: 'space-between' }}>
                    <span className="u-text-mono u-text-style-xsmall">{r.asin}</span>
                    <span className={`app_badge ${TONE[r.status] ?? 'is-idle'} u-text-mono u-text-style-xsmall`}>
                      <span className="app_badge_dot" />
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
                    {MODULE_LABELS[r.module_id] ?? r.module_id}
                  </div>
                  <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.3 }}>
                    {r.provider ?? '—'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
