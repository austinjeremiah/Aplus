'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, type ModuleOption } from '@/lib/api';
import { Button, ErrorBox, PageHead, Skeleton } from '@/components/app/Bits';

function GeneratePageInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [modules, setModules] = useState<ModuleOption[] | null>(null);
  // Prefilled by the Run Detail "regenerate" action so a failed run can be
  // retried with the same brief instead of retyping it.
  const [asin, setAsin] = useState(params.get('asin') ?? '');
  const [moduleId, setModuleId] = useState(params.get('module_id') ?? 'header_970x600');
  const [brief, setBrief] = useState(params.get('brief') ?? '');
  const [demo, setDemo] = useState<'' | 'pricing' | 'safe_zone'>('');
  const [forceFail, setForceFail] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    api.modules().then(setModules).catch((e) => setError(e.message));
  }, []);

  const asinValid = asin.trim().length > 0;
  const briefValid = brief.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!asinValid || !briefValid || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await api.generate({
        asin: asin.trim(),
        module_id: moduleId,
        brief: brief.trim(),
        demo_violation: demo || null,
        force_fail_first: forceFail,
      });
      router.push(`/runs/${res.job_id}?kind=job`);
    } catch (err) {
      // Keep every field intact — losing a written brief to a network blip is
      // the fastest way to make someone distrust the tool.
      setError(err instanceof ApiError ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const selected = modules?.find((m) => m.id === moduleId);

  return (
    <>
      <PageHead
        eyebrow="New generation"
        title="Brief intake"
        lede="One ASIN, one module. The pipeline generates, scores it against Amazon's A+ rules, and retries against the specific violation until it passes."
      />

      {error ? <ErrorBox message={error} onRetry={() => setError(null)} /> : null}

      <div className="app_grid is-split">
        <form onSubmit={submit} className="app_panel">
          <div className="app_field">
            <label htmlFor="asin" className="u-text-mono u-text-style-xsmall">
              ASIN <span style={{ opacity: 0.5 }}>· required</span>
            </label>
            <input
              id="asin"
              className="app_input u-text-style-main"
              placeholder="B0C1234XYZ"
              value={asin}
              onChange={(e) => setAsin(e.target.value)}
              maxLength={32}
            />
            {touched && !asinValid ? (
              <span className="u-text-style-xsmall" style={{ color: '#ef6a5f' }}>
                An ASIN is required.
              </span>
            ) : null}
          </div>

          <div className="app_field">
            <label htmlFor="module" className="u-text-mono u-text-style-xsmall">
              Module type
            </label>
            {modules ? (
              <select
                id="module"
                className="app_select u-text-style-main"
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
              >
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.display}
                  </option>
                ))}
              </select>
            ) : (
              <Skeleton h="3rem" />
            )}
            {selected ? (
              <span className="u-text-style-xsmall" style={{ opacity: 0.5 }}>
                Rendered at {selected.canvas} ({selected.aspect_ratio}), downscaled on export. {selected.notes}
              </span>
            ) : null}
          </div>

          <div className="app_field">
            <label htmlFor="brief" className="u-text-mono u-text-style-xsmall">
              Product brief <span style={{ opacity: 0.5 }}>· required</span>
            </label>
            <textarea
              id="brief"
              className="app_textarea u-text-style-main"
              placeholder="Insulated matte-black stainless steel water bottle, 32oz, outdoorsy tone, cool neutral palette"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={4000}
            />
            {touched && !briefValid ? (
              <span className="u-text-style-xsmall" style={{ color: '#ef6a5f' }}>
                Describe the product so the model has something to work with.
              </span>
            ) : null}
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Queueing…' : 'Generate'}
          </Button>
        </form>

        <aside className="app_panel">
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55, marginBottom: '1rem' }}>
            DEMO CONTROLS
          </div>
          <p className="u-text-style-small" style={{ opacity: 0.6, marginBottom: '1.5rem' }}>
            The failure paths are the interesting ones, so they can be triggered
            deliberately rather than waiting for a model to misbehave on cue.
          </p>

          <div className="app_field">
            <label htmlFor="demo" className="u-text-mono u-text-style-xsmall">
              Force a rubric violation
            </label>
            <select
              id="demo"
              className="app_select u-text-style-main"
              value={demo}
              onChange={(e) => setDemo(e.target.value as typeof demo)}
            >
              <option value="">None — normal generation</option>
              <option value="pricing">Pricing overlay (&ldquo;50% OFF&rdquo;)</option>
              <option value="safe_zone">Text in the mobile safe zone</option>
            </select>
            <span className="u-text-style-xsmall" style={{ opacity: 0.5 }}>
              Attempt 1 will be rejected, then regenerated against the violation.
            </span>
          </div>

          <label className="app_row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={forceFail} onChange={(e) => setForceFail(e.target.checked)} />
            <span className="u-text-style-small">Sabotage the primary provider</span>
          </label>
          <span className="u-text-style-xsmall" style={{ opacity: 0.5 }}>
            Proves the fallback chain by breaking the first provider&rsquo;s model slug.
          </span>
        </aside>
      </div>
    </>
  );
}


/* useSearchParams() forces client-side bailout, which Next requires a
   Suspense boundary for at build time. */
export default function GeneratePage() {
  return (
    <Suspense fallback={<Skeleton h="18rem" />}>
      <GeneratePageInner  />
    </Suspense>
  );
}
