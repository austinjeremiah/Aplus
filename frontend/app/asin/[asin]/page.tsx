'use client';

/**
 * Per-ASIN report — is this listing's A+ content ready to publish?
 *
 * A seller owns a listing, not a run. This answers the question they actually
 * have: which modules exist, which are blocked, and what single property is
 * weakest across the whole set. A+ Content is a set of modules, so a module
 * with no asset is a finding, not missing data.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import AppShell from '@/components/app/AppShell';
import { ApiError, api, assetSrc, money, type AsinModuleRow, type AsinReport } from '@/lib/api';

const TONE: Record<string, string> = {
  passed: '#6dd39a',
  approved: '#6dd39a',
  needs_review: '#e5b552',
  failed: '#f0736a',
  rejected: '#f0736a',
  not_generated: '#938f8a',
};

function scoreTone(score: number | null): string {
  if (score == null) return '#938f8a';
  if (score >= 70) return '#6dd39a';
  if (score >= 45) return '#e5b552';
  return '#f0736a';
}

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

function ModuleCard({ m }: { m: AsinModuleRow }) {
  const tone = TONE[m.status] ?? '#938f8a';

  const body = (
    <>
      <div className="app_card_media" style={{ opacity: m.generated ? 1 : 0.25 }}>
        {m.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetSrc(m.asset_url)} alt={m.label} loading="lazy" />
        ) : null}
      </div>
      <div className="app_card_body">
        <div className="app_row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <span className="u-text-style-small">{m.label}</span>
          {m.readiness_score != null ? (
            <span
              className="u-text-mono u-text-style-xsmall"
              style={{ color: scoreTone(m.readiness_score) }}
            >
              {m.readiness_score}
            </span>
          ) : null}
        </div>

        <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.4 }}>
          {m.display}
        </div>

        <div className="app_row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <span className="u-text-mono u-text-style-xsmall" style={{ color: tone }}>
            {m.status.replace(/_/g, ' ')}
          </span>
          <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.3 }}>
            {m.attempts ? `${m.attempts} attempt${m.attempts === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        {/* The blocking violation is the only thing a seller can act on here,
            so it outranks every other detail on the card. */}
        {m.blocking.length ? (
          <div className="u-text-style-xsmall" style={{ color: '#f0736a', opacity: 0.9 }}>
            {m.blocking[0]}
          </div>
        ) : null}
      </div>
    </>
  );

  if (!m.generated) {
    return (
      <div className="app_card" style={{ cursor: 'default' }}>
        {body}
        <div className="app_card_body" style={{ paddingTop: 0 }}>
          <Link
            href={`/generate?module_id=${m.module_id}`}
            className="u-text-style-xsmall"
            style={{ textDecoration: 'underline', opacity: 0.6 }}
          >
            Generate this module
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Link href={`/runs/${m.run_id}`} className="app_card">
      {body}
    </Link>
  );
}

export default function AsinReportPage({ params }: { params: Promise<{ asin: string }> }) {
  const { asin } = use(params);
  const [report, setReport] = useState<AsinReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .asinReport(asin)
      .then(setReport)
      .catch((e: ApiError) => setError(e.message));
  }, [asin]);

  useEffect(load, [load]);

  const s = report?.summary;
  const coverage = s ? `${s.modules_generated}/${s.modules_total}` : '—';

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            LISTING REPORT
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            {decodeURIComponent(asin)}
          </h1>
          <p className="u-text-style-small u-max-width-60ch" style={{ opacity: 0.5, marginTop: '0.7rem' }}>
            The current state of every A+ module for this product. Readiness is measured
            from the pixels, not predicted from sales data.
          </p>
        </div>
        <Link href="/asin" className="u-text-style-small" style={{ opacity: 0.5, textDecoration: 'underline' }}>
          All listings
        </Link>
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">ERROR</div>
          <div className="u-text-style-small">{error}</div>
        </div>
      ) : null}

      <div className="app_grid_stats">
        {s ? (
          <>
            <Stat label="MODULE COVERAGE" value={coverage} hint="A+ content is a set" />
            <Stat
              label="COMPLIANT"
              value={s.modules_compliant}
              hint={s.modules_unresolved ? `${s.modules_unresolved} need a decision` : 'none blocked'}
            />
            <Stat
              label="READINESS"
              value={
                s.readiness_score == null ? (
                  '—'
                ) : (
                  <span style={{ color: scoreTone(s.readiness_score) }}>{s.readiness_score}</span>
                )
              }
              hint="mean across scored assets"
            />
            <Stat label="ATTEMPTS" value={s.total_attempts} hint="incl. retries + fallbacks" />
            <Stat label="SPEND" value={money(s.total_cost_usd)} hint="free-tier chain" />
          </>
        ) : (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="app_skeleton" style={{ height: '7rem' }} />
          ))
        )}
      </div>

      {/* The single most actionable line on the page. */}
      {s?.weakest ? (
        <div
          className="app_panel app_section"
          style={{ borderColor: scoreTone(s.weakest.score) }}
        >
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            WEAKEST ACROSS THE SET
          </div>
          <div
            className="u-text-style-h4 u-text-trim-off"
            style={{ marginTop: '0.5rem', color: scoreTone(s.weakest.score) }}
          >
            {s.weakest.label} — {s.weakest.score}/100
          </div>
          {s.weakest.evidence ? (
            <p className="u-text-style-small" style={{ opacity: 0.65, marginTop: '0.6rem' }}>
              {s.weakest.evidence}
              {s.weakest.modules.length ? ` — ${s.weakest.modules.join(', ')}` : ''}
            </p>
          ) : (
            <p className="u-text-style-small" style={{ opacity: 0.5, marginTop: '0.6rem' }}>
              No asset falls below the concern threshold on this property.
            </p>
          )}
        </div>
      ) : null}

      <section className="app_section">
        <h2 className="u-text-style-h4 u-text-trim-off">Modules</h2>
        <p className="u-text-style-small" style={{ opacity: 0.45, margin: '0.6rem 0 1.5rem' }}>
          A module with no asset is a gap in the listing, not missing data.
        </p>
        <div className="app_cards">
          {(report?.modules ?? []).map((m) => (
            <ModuleCard key={m.module_id} m={m} />
          ))}
        </div>
      </section>

      {s?.providers.length ? (
        <section className="app_section">
          <h2 className="u-text-style-h4 u-text-trim-off">Who served this listing</h2>
          <div className="app_panel" style={{ marginTop: '1.2rem' }}>
            {s.providers.map((p) => (
              <div className="app_kv" key={p.provider}>
                <span className="u-text-mono u-text-style-small">{p.provider}</span>
                <span className="u-text-style-small" style={{ opacity: 0.6 }}>
                  {p.attempts} attempt{p.attempts === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
