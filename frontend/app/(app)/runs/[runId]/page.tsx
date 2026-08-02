'use client';

/**
 * Run detail — the "did it work" page.
 *
 * The route param doubles as a job id (right after submitting) or a run id
 * (when arriving from the gallery), because the job id is all the generate
 * form has at redirect time. `kind=job` disambiguates; without it we try the
 * run first and fall back to the job.
 */

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  assetSrc,
  ApiError,
  money,
  shortId,
  type Compliance,
  type Job,
  type Run,
} from '@/lib/api';
import {
  ButtonAnchor,
  ButtonLink,
  ComplianceBadge,
  ErrorBox,
  PageHead,
  Skeleton,
  StatusBadge,
  Violations,
} from '@/components/app/Bits';
import LineageTimeline from '@/components/app/LineageTimeline';

const POLL_MS = 2500;

function RunDetailPageInner({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const search = useSearchParams();
  const isJobHint = search.get('kind') === 'job';

  const [job, setJob] = useState<Job | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [lineage, setLineage] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRun = useCallback(async (id: string) => {
    const r = await api.run(id);
    setRun(r);
    setLineage(await api.lineage(id).catch(() => []));
  }, []);

  const tick = useCallback(async () => {
    try {
      if (!isJobHint) {
        // Try the run id directly first.
        try {
          await loadRun(runId);
          setLoading(false);
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }

      const j = await api.job(runId);
      setJob(j);

      if (j.status === 'not_found') {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (j.status === 'complete' && j.result?.run_id) {
        await loadRun(j.result.run_id);
        setLoading(false);
        return;
      }
      if (j.status === 'failed') {
        setLoading(false);
        return;
      }
      // Still working — poll again.
      setLoading(false);
      timer.current = setTimeout(tick, POLL_MS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setLoading(false);
    }
  }, [runId, isJobHint, loadRun]);

  useEffect(() => {
    tick();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tick]);

  const working = job && (job.status === 'queued' || job.status === 'in_progress');
  const compliance: Compliance | null = run?.compliance ?? job?.result?.compliance ?? null;

  if (loading) {
    return (
      <>
        <PageHead eyebrow="Run" title="Loading…" />
        <Skeleton h="18rem" />
      </>
    );
  }

  if (notFound) {
    return (
      <>
        <PageHead eyebrow="Run" title="Not found" lede={`No job or run matches ${runId}.`} />
        <ButtonLink href="/generate">Start a new generation</ButtonLink>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow={`Run · ${shortId(runId, 8)}`}
        title={run ? `${run.asin} · ${run.module_id.replace(/_/g, ' ')}` : 'Generating…'}
        actions={
          run ? (
            <>
              <ButtonAnchor href={api.exportUrl(run.run_id)} download>
                Export with manifest
              </ButtonAnchor>
              <ButtonLink
                href={`/generate?asin=${encodeURIComponent(run.asin)}&module_id=${run.module_id}`}
              >
                Regenerate
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      {error ? <ErrorBox message={error} onRetry={() => tick()} /> : null}

      {working ? (
        <div className="app_panel" style={{ marginBottom: '2rem' }}>
          <div className="app_row">
            <StatusBadge status={job!.status} />
            <span className="u-text-style-main" style={{ opacity: 0.65 }}>
              Generating, scoring against the rubric, and retrying if it fails. This
              usually takes 10–40 seconds.
            </span>
          </div>
          <div style={{ marginTop: '1.25rem' }}>
            <Skeleton h="0.4rem" />
          </div>
        </div>
      ) : null}

      {job?.status === 'failed' ? (
        <div className="app_error" style={{ marginBottom: '2rem' }}>
          <div className="u-text-mono u-text-style-xsmall">PIPELINE FAILURE</div>
          {/* The specific provider error, not a generic message — it is the
              useful thing while building and it reads as credible in a demo. */}
          <div className="u-text-style-main app_mono_break">{job.error ?? 'unknown error'}</div>
        </div>
      ) : null}

      {run ? (
        <div className="app_grid is-split">
          <div>
            <div className="app_panel is-flush">
              {run.asset_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetSrc(run.asset_url)} alt={`${run.asin} ${run.module_id}`} style={{ width: '100%', display: 'block' }} />
              ) : (
                <div style={{ padding: '4rem', textAlign: 'center', opacity: 0.5 }}>No asset produced</div>
              )}
            </div>

            <div className="app_section">
              <h2 className="u-text-style-h4 u-text-trim-off">Lineage</h2>
              <p className="u-text-style-small" style={{ opacity: 0.55, margin: '0.5rem 0 1.75rem' }}>
                Every attempt behind this asset, including the ones that failed.
              </p>
              <LineageTimeline entries={lineage} />
            </div>
          </div>

          <aside>
            <div className="app_panel">
              <div className="app_row" style={{ justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <StatusBadge status={run.status} />
                <ComplianceBadge compliance={compliance} />
              </div>

              <Row k="Provider" v={run.provider ?? '—'} />
              <Row k="Model" v={run.model ?? '—'} mono />
              <Row k="Cost" v={money(run.cost_usd)} />
              <Row k="Duration" v={run.duration_sec ? `${run.duration_sec.toFixed(1)}s` : '—'} />
              <Row k="Attempt" v={String(run.attempt)} />
              <Row k="SHA-256" v={shortId(run.asset_sha256, 24)} mono />
              <Row k="Manifest hash" v={shortId(run.canonical_hash, 24)} mono />
              {run.review_decision ? <Row k="Human override" v={run.review_decision} /> : null}
            </div>

            {compliance ? (
              <div className="app_panel" style={{ marginTop: '1.5rem' }}>
                <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55 }}>
                  COMPLIANCE
                </div>
                <div className="u-text-style-h5 u-text-trim-off" style={{ margin: '0.5rem 0 0.75rem' }}>
                  {compliance.status === 'passed'
                    ? 'Passes the rubric'
                    : compliance.status === 'needs_review'
                      ? 'Could not be fully audited'
                      : 'Rejected'}
                </div>
                <p className="u-text-style-small" style={{ opacity: 0.55 }}>
                  {compliance.checks_run.length} checks run
                  {compliance.judge ? ` · judged by ${compliance.judge}` : ''}
                </p>
                {compliance.notes ? (
                  <p className="u-text-style-small" style={{ opacity: 0.5, marginTop: '0.5rem' }}>
                    {compliance.notes}
                  </p>
                ) : null}
                <Violations items={compliance.violations} />
                {compliance.text_seen ? (
                  <div style={{ marginTop: '1rem' }}>
                    <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.45 }}>
                      TEXT DETECTED IN IMAGE
                    </div>
                    <div className="u-text-style-small" style={{ opacity: 0.75 }}>
                      “{compliance.text_seen}”
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="app_panel" style={{ marginTop: '1.5rem' }}>
              <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55, marginBottom: '0.75rem' }}>
                PROVENANCE
              </div>
              <p className="u-text-style-small" style={{ opacity: 0.6, marginBottom: '1rem' }}>
                Export embeds this run&rsquo;s manifest into the file. Anyone can drop it
                on the verify page to confirm where it came from.
              </p>
              <Link href="/verify" className="u-text-style-small" style={{ textDecoration: 'underline' }}>
                Open verify page →
              </Link>
            </div>
          </aside>
        </div>
      ) : null}
    </>
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


/* useSearchParams() forces client-side bailout, which Next requires a
   Suspense boundary for at build time. */
export default function RunDetailPage(props: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={<Skeleton h="18rem" />}>
      <RunDetailPageInner {...props} />
    </Suspense>
  );
}
