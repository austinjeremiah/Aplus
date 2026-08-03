'use client';

/**
 * Public provenance verification — deliberately NOT behind the sign-in.
 *
 * The whole point is that a third party handed an exported image (an Amazon
 * reviewer, a client, a marketplace auditor) can confirm where it came from
 * without an account and without having seen the rest of the app.
 */

import '@/app/app.css';

import { useRef, useState } from 'react';
import AppNav from '@/components/app/AppNav';
import LineageTimeline from '@/components/app/LineageTimeline';
import { ApiError, api, assetSrc, money, type VerifyResult } from '@/lib/api';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

export default function VerifyPage() {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [runId, setRunId] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<VerifyResult>, name?: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFilename(name ?? null);
    try {
      setResult(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submitFile(file: File) {
    if (!ACCEPT.includes(file.type)) {
      setError(`${file.type || 'That file type'} isn't supported — upload a PNG, JPEG or WebP.`);
      return;
    }
    run(() => api.verify({ file }), file.name);
  }

  const ok = result?.valid;

  return (
    <div className="page_wrap">
      {/* Same bar as the signed-in pages: it shows the full links to a
          signed-in visitor and falls back to the public header for anyone
          arriving with just an exported image and no account. */}
      <AppNav />

      <main className="app_main">
        <div className="app_container" style={{ maxWidth: '60rem' }}>
          <header className="app_head">
            <div>
              <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
                VERIFY
              </div>
              <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
                Where did this image come from?
              </h1>
              <p
                className="u-text-style-main u-max-width-60ch"
                style={{ opacity: 0.55, marginTop: '0.9rem' }}
              >
                Drop an exported asset to read the manifest embedded inside it — the provider,
                model, cost, and every attempt that preceded it. No account needed.
              </p>
            </div>
          </header>

          {error ? (
            <div className="app_error">
              <div className="u-text-mono u-text-style-xsmall">ERROR</div>
              <div className="u-text-style-small">{error}</div>
            </div>
          ) : null}

          <div
            className={`app_dropzone ${over ? 'is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) submitFile(f);
            }}
            onClick={() => input.current?.click()}
          >
            <input
              ref={input}
              type="file"
              accept={ACCEPT.join(',')}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) submitFile(f);
              }}
            />
            <div className="u-text-style-h5 u-text-trim-off">
              {busy ? 'Reading manifest…' : over ? 'Drop to verify' : 'Drop an image here'}
            </div>
            <p className="u-text-style-small" style={{ opacity: 0.5, marginTop: '0.7rem' }}>
              {filename ?? 'PNG, JPEG or WebP · or click to browse'}
            </p>
          </div>

          <div className="app_panel" style={{ marginTop: '1.5rem' }}>
            <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5, marginBottom: '0.9rem' }}>
              OR LOOK UP BY RUN ID
            </div>
            <div className="app_row" style={{ flexWrap: 'nowrap' }}>
              <input
                className="app_input u-text-mono u-text-style-small"
                placeholder="0e76aabf-fef1-4d58-…"
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              />
              <button
                onClick={() => runId.trim() && run(() => api.verify({ run_id: runId.trim() }))}
                disabled={busy || !runId.trim()}
                data-btn-default=""
                className="g_btn_main w-inline-block"
                style={!runId.trim() ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
              >
                <div className="g_btn_text_contain">
                  <div className="g_btn_text u-text-style-small u-text-trim-off">Look up</div>
                </div>
              </button>
            </div>
          </div>

          {result ? (
            <div className="app_section">
              <div
                className="app_panel"
                style={{ borderColor: ok ? '#6dd39a' : '#f0736a', color: ok ? '#6dd39a' : '#f0736a' }}
              >
                <div className="u-text-style-h3 u-text-trim-off">
                  {ok ? 'Verified' : 'Not verified'}
                </div>
                <p className="u-text-style-main" style={{ marginTop: '0.6rem', opacity: 0.85 }}>
                  {ok
                    ? 'The manifest hash matches its contents, and this asset is on record.'
                    : (result.message ?? 'This file could not be matched to anything we generated.')}
                </p>
                <p className="u-text-mono u-text-style-xsmall" style={{ marginTop: '0.9rem', opacity: 0.7 }}>
                  {result.source === 'embedded_manifest'
                    ? 'MANIFEST READ FROM INSIDE THE FILE'
                    : result.source === 'sha256_lookup'
                      ? 'MATCHED BY SHA-256 OF THE FILE CONTENTS'
                      : 'MATCHED BY REFERENCE'}
                </p>
              </div>

              {result.run ? (
                <>
                  <div className="app_grid_split app_section">
                    <div className="app_panel is-flush">
                      {result.run.asset_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={assetSrc(result.run.asset_url)}
                          alt="verified asset"
                          style={{ width: '100%', display: 'block' }}
                        />
                      ) : null}
                    </div>
                    <div className="app_panel">
                      <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5, marginBottom: '1rem' }}>
                        ON RECORD
                      </div>
                      {[
                        ['ASIN', result.run.asin],
                        ['Module', result.run.module_id.replace(/_/g, ' ')],
                        ['Provider', result.run.provider ?? '—'],
                        ['Model', result.run.model ?? '—'],
                        ['Cost', money(result.run.cost_usd)],
                        ['Manifest hash', result.integrity?.canonical_hash?.slice(0, 20) ?? '—'],
                        ['Created', result.run.created_at?.slice(0, 19).replace('T', ' ') ?? '—'],
                      ].map(([k, v]) => (
                        <div className="app_kv" key={k}>
                          <span className="u-text-style-small">{k}</span>
                          <span className="u-text-style-small app_break">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="app_section">
                    <h2 className="u-text-style-h4 u-text-trim-off">Lineage</h2>
                    <p className="u-text-style-small" style={{ opacity: 0.45, margin: '0.6rem 0 1.8rem' }}>
                      Every attempt behind this file, oldest first.
                    </p>
                    <LineageTimeline entries={result.lineage} />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
