'use client';

/**
 * Asset gallery.
 *
 * The view toggle is not a UI filter — it switches which B2 key layout the
 * assets are read through. "By ASIN" is the hierarchical run tree;
 * "Asset library" is the content-addressable tree, where byte-identical
 * outputs collapse onto a single key.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, MODULE_LABELS, type Run } from '@/lib/api';
import { AssetCard, Empty, ErrorBox, PageHead, SkeletonGrid } from '@/components/app/Bits';

const STATUSES = ['', 'passed', 'approved', 'failed', 'needs_review', 'generated'];

export default function GalleryPage() {
  const [view, setView] = useState<'hierarchical' | 'dedup'>('hierarchical');
  const [asin, setAsin] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const res = await api.gallery({ view, asin, module_id: moduleId, status });
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setItems([]);
    }
  }, [view, asin, moduleId, status]);

  useEffect(() => {
    const t = setTimeout(load, asin ? 350 : 0); // debounce free-text ASIN
    return () => clearTimeout(t);
  }, [load, asin]);

  return (
    <>
      <PageHead
        eyebrow="Assets"
        title="Gallery"
        lede="Every generated asset, read through either B2 storage layout."
      />

      <div className="app_panel" style={{ marginBottom: '2rem' }}>
        <div className="app_row" style={{ justifyContent: 'space-between' }}>
          <div className="app_row">
            {(['hierarchical', 'dedup'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="u-text-style-small"
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '999px',
                  border: '1px solid currentColor',
                  opacity: view === v ? 1 : 0.4,
                }}
              >
                {v === 'hierarchical' ? 'By ASIN' : 'Asset library (deduped)'}
              </button>
            ))}
          </div>
          <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.45 }}>
            {view === 'hierarchical'
              ? '{prefix}/runs/{asin}/{date}/{run_id}/'
              : '{prefix}/assets/{ab}/{cd}/{sha256}'}
          </span>
        </div>

        <div className="app_row" style={{ marginTop: '1.25rem' }}>
          <input
            className="app_input u-text-style-small"
            placeholder="Filter by ASIN"
            value={asin}
            onChange={(e) => setAsin(e.target.value)}
            style={{ flex: '1 1 12rem' }}
          />
          <select
            className="app_select u-text-style-small"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            style={{ flex: '1 1 12rem' }}
          >
            <option value="">All modules</option>
            {Object.entries(MODULE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="app_select u-text-style-small"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ flex: '1 1 10rem' }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {items === null ? (
        <SkeletonGrid n={8} />
      ) : items.length === 0 ? (
        <Empty
          title="No assets match these filters"
          body="Try clearing the ASIN or status filter, or generate something new."
        />
      ) : (
        <>
          <p className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.45, marginBottom: '1rem' }}>
            {items.length} ASSET{items.length === 1 ? '' : 'S'}
          </p>
          <div className="app_grid">
            {items.map((r) => (
              <AssetCard key={r.run_id} run={r} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
