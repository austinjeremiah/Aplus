'use client';

/**
 * Run detail — the "did it work" page.
 *
 * The route param is a job id right after submitting and a run id when
 * arriving from the gallery, because a job id is all the form has at redirect
 * time. `kind=job` disambiguates; without it the run is tried first.
 */

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/app/AppShell';
import LineageTimeline from '@/components/app/LineageTimeline';
import {
  ApiError,
  MODULE_LABELS,
  api,
  assetSrc,
  money,
  type Compliance,
  type Job,
  type Run,
} from '@/lib/api';

const POLL_MS = 2500;

function Arrow() {
  return (
    <svg width="100%" viewBox="0 0 12 12" fill="none" className="g_btn_svg" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.90954 9.09046L9 3L2.90954 3.09046L2.90213 4.32367L6.86437 4.25391L2.55914 8.55914L3.44086 9.44086L7.74609 5.13563L7.68708 9.10862L8.90954 9.09046Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="app_kv">
      <span className="u-text-style-small">{k}</span>
      <span className={`u-text-style-small app_break ${mono ? 'u-text-mono' : ''}`}>{v}</span>
    </div>
  );
}

function RunDetail({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const isJob = useSearchParams().get('kind') === 'job';

  const [job, setJob] = useState<Job | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [lineage, setLineage] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRun = useCallback(async (id: string) => {
    setRun(await api.run(id));
    setLineage(await api.lineage(id).catch(() => []));
  }, []);

  const tick = useCallback(async () => {
    try {
      if (!isJob) {
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
      setLoading(false);

      if (j.status === 'not_found') return setMissing(true);
      if (j.status === 'complete' && j.result?.run_id) return loadRun(j.result.run_id);
      if (j.status === 'failed') return;

      timer.current = setTimeout(tick, POLL_MS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setLoading(false);
    }
  }, [runId, isJob, loadRun]);

  useEffect(() => {
    tick();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tick]);

  const working = job?.status === 'queued' || job?.status === 'in_progress';
  const compliance: Compliance | null = run?.compliance ?? job?.result?.compliance ?? null;
  const approved = compliance?.status === 'passed' || run?.status === 'approved';

  if (loading) {
    return (
      <AppShell>
        <div className="app_skeleton" style={{ height: '20rem' }} />
      </AppShell>
    );
  }

  if (missing) {
    return (
      <AppShell>
        <header className="app_head">
          <div>
            <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
              RUN
            </div>
            <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
              Not found
            </h1>
          </div>
        </header>
        <p className="u-text-style-main" style={{ opacity: 0.5 }}>
          No job or run matches <span className="u-text-mono">{runId}</span>.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            RUN · {runId.slice(0, 8)}
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            {run ? run.asin : 'Generating…'}
          </h1>
          {run ? (
            <div className="u-text-style-small" style={{ opacity: 0.45, marginTop: '0.5rem' }}>
              {MODULE_LABELS[run.module_id] ?? run.module_id}
            </div>
          ) : null}
        </div>

        {run ? (
          <div className="app_row">
            <a href={api.exportUrl(run.run_id)} download data-btn-default="" className="g_btn_main w-inline-block">
              <div className="g_btn_text_contain">
                <div className="g_btn_text u-text-style-small u-text-trim-off">Export with manifest</div>
              </div>
              <div className="g_btn_aside_wrap">
                <div className="g_btn_aside_bg" />
                <Arrow />
              </div>
            </a>
            <Link
              href={`/generate?asin=${encodeURIComponent(run.asin)}&module_id=${run.module_id}`}
              className="u-text-style-small"
              style={{ opacity: 0.5, textDecoration: 'underline' }}
            >
              Regenerate
            </Link>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">ERROR</div>
          <div className="u-text-style-main">{error}</div>
        </div>
      ) : null}

      {working ? (
        <div className="app_panel" style={{ marginBottom: '2rem' }}>
          <div className="app_row">
            <span className="app_badge is-warn u-text-mono u-text-style-xsmall">
              <span className="app_badge_dot" />
              {job?.status === 'queued' ? 'Queued' : 'Generating'}
            </span>
            <span className="u-text-style-small" style={{ opacity: 0.6 }}>
              Generating, scoring against the rubric, and regenerating if it fails. Usually
              15–40 seconds.
            </span>
          </div>
          <div className="app_skeleton" style={{ height: '0.35rem', marginTop: '1.3rem' }} />
        </div>
      ) : null}

      {job?.status === 'failed' ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">PIPELINE FAILURE</div>
          {/* The provider's own error, not a generic message — it is what makes
              the failure diagnosable. */}
          <div className="u-text-style-small app_break">{job.error ?? 'unknown error'}</div>
        </div>
      ) : null}

      {run ? (
        <div className="app_grid_split">
          <section>
            <div className="app_panel is-flush">
              {run.asset_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetSrc(run.asset_url)}
                  alt={`${run.asin} ${run.module_id}`}
                  style={{ width: '100%', display: 'block' }}
                />
              ) : (
                <div style={{ padding: '4rem', textAlign: 'center', opacity: 0.4 }}>
                  No asset produced
                </div>
              )}
            </div>

            <div className="app_section">
              <h2 className="u-text-style-h4 u-text-trim-off">Lineage</h2>
              <p className="u-text-style-small" style={{ opacity: 0.45, margin: '0.6rem 0 1.8rem' }}>
                Every attempt behind this asset, oldest first — including the ones that were
                rejected.
              </p>
              <LineageTimeline entries={lineage} />
            </div>
          </section>

          <aside>
            <div className="app_panel">
              <div
                className="app_row"
                style={{ justifyContent: 'space-between', marginBottom: '1.4rem' }}
              >
                <span className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
                  VERDICT
                </span>
                <span
                  className={`app_badge ${approved ? 'is-pass' : compliance?.status === 'needs_review' ? 'is-warn' : 'is-fail'} u-text-mono u-text-style-xsmall`}
                >
                  <span className="app_badge_dot" />
                  {approved
                    ? 'Compliant'
                    : compliance?.status === 'needs_review'
                      ? 'Needs review'
                      : 'Rejected'}
                </span>
              </div>

              {compliance ? (
                <>
                  <p className="u-text-style-small" style={{ opacity: 0.55 }}>
                    {compliance.checks_run.length} checks run
                    {compliance.judge ? `, judged by ${compliance.judge}` : ''}.
                  </p>

                  {compliance.violations.length ? (
                    <ul className="app_violations">
                      {compliance.violations.map((v, i) => (
                        <li key={i} style={{ borderColor: v.severity === 'error' ? '#f0736a' : '#e5b552' }}>
                          <span className="u-text-mono u-text-style-xsmall">
                            {v.rule.replace(/_/g, ' ')}
                          </span>
                          <span className="u-text-style-small">{v.evidence}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="u-text-style-small" style={{ opacity: 0.45, marginTop: '0.8rem' }}>
                      No violations found.
                    </p>
                  )}

                  {compliance.text_seen ? (
                    <div style={{ marginTop: '1.3rem' }}>
                      <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.4 }}>
                        TEXT READ FROM THE IMAGE
                      </div>
                      <div className="u-text-style-small" style={{ opacity: 0.7, marginTop: '0.35rem' }}>
                        &ldquo;{compliance.text_seen}&rdquo;
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="u-text-style-small" style={{ opacity: 0.45 }}>
                  Not yet scored.
                </p>
              )}
            </div>

            <div className="app_panel" style={{ marginTop: '1.5rem' }}>
              <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5, marginBottom: '1rem' }}>
                PROVENANCE
              </div>
              <Row k="Provider" v={run.provider ?? '—'} />
              <Row k="Model" v={run.model ?? '—'} mono />
              <Row k="Cost" v={money(run.cost_usd)} />
              <Row k="Attempt" v={String(run.attempt)} />
              <Row k="Asset SHA-256" v={run.asset_sha256?.slice(0, 20) ?? '—'} mono />
              <Row k="Manifest hash" v={run.canonical_hash?.slice(0, 20) ?? '—'} mono />
              <p className="u-text-style-xsmall" style={{ opacity: 0.42, marginTop: '1rem' }}>
                Export embeds this manifest into the file. Anyone can drop it on the verify
                page and confirm where it came from, without an account.
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function RunDetailPage(props: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={null}>
      <RunDetail {...props} />
    </Suspense>
  );
}
