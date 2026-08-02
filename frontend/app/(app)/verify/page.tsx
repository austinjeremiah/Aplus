'use client';

/**
 * Public provenance verification.
 *
 * Written to stand alone: someone handed an exported image — an Amazon
 * reviewer, a client, a marketplace auditor — can confirm where it came from
 * without an account and without having seen the rest of the app.
 */

import { useRef, useState } from 'react';
import {
 api,
 assetSrc, ApiError, money, shortId, type VerifyResult } from '@/lib/api';
import { Button, ErrorBox, PageHead, StatusBadge } from '@/components/app/Bits';
import LineageTimeline from '@/components/app/LineageTimeline';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

export default function VerifyPage() {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [runId, setRunId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function submitFile(file: File) {
    if (!ACCEPT.includes(file.type)) {
      setError(`${file.type || 'That file type'} is not supported — upload a PNG, JPEG or WebP.`);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setFilename(file.name);
    try {
      setResult(await api.verify({ file }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitRunId() {
    if (!runId.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setFilename(null);
    try {
      setResult(await api.verify({ run_id: runId.trim() }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Provenance"
        title="Verify an asset"
        lede="Drop an exported image to read the manifest embedded inside it — the provider, model, prompt, cost, and every attempt that preceded it. No account needed."
      />

      {error ? <ErrorBox message={error} onRetry={() => setError(null)} /> : null}

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
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
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
        <p className="u-text-style-small" style={{ opacity: 0.55, marginTop: '0.65rem' }}>
          {filename ?? 'PNG, JPEG or WebP · or click to browse'}
        </p>
      </div>

      <div className="app_panel" style={{ marginTop: '1.5rem' }}>
        <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55, marginBottom: '0.75rem' }}>
          OR LOOK UP BY REFERENCE
        </div>
        <div className="app_row">
          <input
            className="app_input u-text-style-main u-text-mono"
            placeholder="run id"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            style={{ flex: '1 1 20rem' }}
          />
          <Button onClick={submitRunId} disabled={busy || !runId.trim()}>
            Look up
          </Button>
        </div>
      </div>

      {result ? <Result result={result} /> : null}
    </>
  );
}

function Result({ result }: { result: VerifyResult }) {
  const ok = result.valid;
  const run = result.run;

  const sourceLabel =
    result.source === 'embedded_manifest'
      ? 'Manifest embedded in the file'
      : result.source === 'sha256_lookup'
        ? 'Matched by SHA-256 of the file contents'
        : 'Matched by reference';

  return (
    <div className="app_section">
      <div
        className="app_panel"
        style={{ borderColor: ok ? '#5fd08a' : '#ef6a5f', color: ok ? '#5fd08a' : '#ef6a5f' }}
      >
        <div className="u-text-style-h3 u-text-trim-off">{ok ? 'Verified' : 'Not verified'}</div>
        <p className="u-text-style-main" style={{ marginTop: '0.5rem', opacity: 0.85 }}>
          {ok
            ? 'The manifest hash matches its contents, and this asset is on record.'
            : (result.message ?? 'This file could not be matched to any asset we generated.')}
        </p>
        <p className="u-text-mono u-text-style-xsmall" style={{ marginTop: '0.75rem', opacity: 0.7 }}>
          {sourceLabel}
        </p>
      </div>

      {result.integrity ? (
        <div className="app_grid is-stats" style={{ marginTop: '1.5rem' }}>
          <Tile k="Hash check" v={result.integrity.hash_ok ? 'Passed' : 'Failed'} />
          <Tile k="Canonical hash" v={shortId(result.integrity.canonical_hash, 16)} mono />
          <Tile k="Unverified assets" v={String(result.integrity.unverified_assets.length)} />
          <Tile k="Metadata issues" v={String(result.integrity.invalid_metadata.length)} />
        </div>
      ) : null}

      {run ? (
        <div className="app_grid is-split app_section">
          <div>
            {run.asset_url ? (
              <div className="app_panel is-flush">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetSrc(run.asset_url)} alt="verified asset" style={{ width: '100%', display: 'block' }} />
              </div>
            ) : null}
            <div className="app_section">
              <h2 className="u-text-style-h4 u-text-trim-off">Lineage</h2>
              <p className="u-text-style-small" style={{ opacity: 0.55, margin: '0.5rem 0 1.75rem' }}>
                The full history behind this file, oldest attempt first.
              </p>
              <LineageTimeline entries={result.lineage} />
            </div>
          </div>

          <aside className="app_panel">
            <div className="app_row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55 }}>
                ON RECORD
              </span>
              <StatusBadge status={run.status} />
            </div>
            <Row k="ASIN" v={run.asin} />
            <Row k="Module" v={run.module_id.replace(/_/g, ' ')} />
            <Row k="Provider" v={run.provider ?? '—'} />
            <Row k="Model" v={run.model ?? '—'} mono />
            <Row k="Cost" v={money(run.cost_usd)} />
            <Row k="Run id" v={shortId(run.run_id, 18)} mono />
            <Row k="Created" v={run.created_at?.slice(0, 19).replace('T', ' ') ?? '—'} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Tile({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="app_stat">
      <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55 }}>
        {k}
      </div>
      <div className={`u-text-style-h6 ${mono ? 'u-text-mono' : ''} app_mono_break`}>{v}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="app_row" style={{ justifyContent: 'space-between', padding: '0.4rem 0' }}>
      <span className="u-text-style-small" style={{ opacity: 0.5 }}>
        {k}
      </span>
      <span className={`u-text-style-small ${mono ? 'u-text-mono' : ''} app_mono_break`} style={{ textAlign: 'right' }}>
        {v}
      </span>
    </div>
  );
}
