'use client';

/**
 * Brief intake — one ASIN, one module, one description.
 *
 * Submitting queues a job and redirects to the run page. The job id is all we
 * have at redirect time; the run page resolves it to a real run once the first
 * poll comes back.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/app/AppShell';
import { ApiError, api, type ModuleOption } from '@/lib/api';

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

function GenerateInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [modules, setModules] = useState<ModuleOption[] | null>(null);
  // Prefilled when arriving from a run's "regenerate" action, so a failed
  // brief doesn't have to be retyped.
  const [asin, setAsin] = useState(params.get('asin') ?? '');
  const [moduleId, setModuleId] = useState(params.get('module_id') ?? 'header_970x600');
  const [brief, setBrief] = useState(params.get('brief') ?? '');
  const [demo, setDemo] = useState<'' | 'pricing' | 'safe_zone'>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    api.modules().then(setModules).catch((e: ApiError) => setError(e.message));
  }, []);

  const asinOk = asin.trim().length > 0;
  const briefOk = brief.trim().length > 0;
  const selected = modules?.find((m) => m.id === moduleId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!asinOk || !briefOk || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await api.generate({
        asin: asin.trim(),
        module_id: moduleId,
        brief: brief.trim(),
        demo_violation: demo || null,
      });
      router.push(`/runs/${res.job_id}?kind=job`);
    } catch (err) {
      // Every field is preserved — losing a written brief to a network blip is
      // the fastest way to lose trust in a tool.
      setError(err instanceof ApiError ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <AppShell>

      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            NEW GENERATION
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            Brief intake
          </h1>
        </div>
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">COULD NOT QUEUE</div>
          <div className="u-text-style-main">{error}</div>
        </div>
      ) : null}

      <div className="app_grid_split">
        <form onSubmit={submit} className="app_panel">
          <div className="app_field">
            <label htmlFor="asin" className="u-text-mono u-text-style-xsmall">
              ASIN
            </label>
            <input
              id="asin"
              className="app_input u-text-style-main"
              placeholder="B0C1234XYZ"
              value={asin}
              onChange={(e) => setAsin(e.target.value)}
              maxLength={32}
              autoComplete="off"
            />
            {touched && !asinOk ? (
              <span className="u-text-style-xsmall" style={{ color: '#f0736a' }}>
                An ASIN is required.
              </span>
            ) : null}
          </div>

          <div className="app_field">
            <label htmlFor="module" className="u-text-mono u-text-style-xsmall">
              MODULE
            </label>
            {modules ? (
              <select
                id="module"
                className="app_input u-text-style-main"
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
              <div className="app_skeleton" style={{ height: '3rem' }} />
            )}
            {selected ? (
              <span className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
                Rendered at {selected.canvas}, downscaled on export. {selected.notes}
              </span>
            ) : null}
          </div>

          <div className="app_field">
            <label htmlFor="brief" className="u-text-mono u-text-style-xsmall">
              PRODUCT BRIEF
            </label>
            <textarea
              id="brief"
              className="app_input app_textarea u-text-style-main"
              placeholder="Insulated matte-black stainless steel water bottle, 32oz. Outdoorsy tone, cool neutral palette, studio lighting on a light marble surface."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={4000}
            />
            {touched && !briefOk ? (
              <span className="u-text-style-xsmall" style={{ color: '#f0736a' }}>
                Describe the product so the model has something to work with.
              </span>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitting}
            data-btn-default=""
            className="g_btn_main w-inline-block"
            style={submitting ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
          >
            <div className="g_btn_text_contain">
              <div className="g_btn_text u-text-style-small u-text-trim-off">
                {submitting ? 'Queueing…' : 'Generate'}
              </div>
            </div>
            <div className="g_btn_aside_wrap">
              <div className="g_btn_aside_bg" />
              <Arrow />
            </div>
          </button>
        </form>

        <aside>
          <div className="app_panel">
            <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
              WHAT HAPPENS NEXT
            </div>
            <ol className="app_steps u-text-style-small">
              <li>
                <strong>Generate</strong> — the provider chain is walked until one returns an
                image. Every attempt is recorded, including failures.
              </li>
              <li>
                <strong>Score</strong> — dimensions, colour mode and file size are checked
                deterministically; pricing claims, competitor marks and the mobile safe zone
                are read from the image itself.
              </li>
              <li>
                <strong>Correct</strong> — a rejection feeds the specific violation back into
                a new run, linked to the one it supersedes.
              </li>
              <li>
                <strong>Store</strong> — asset and manifest land in Backblaze B2 under two key
                layouts, with the manifest Object-Locked.
              </li>
            </ol>
          </div>

          <div className="app_panel" style={{ marginTop: '1.5rem' }}>
            <div className="app_field" style={{ marginBottom: 0 }}>
              <label htmlFor="demo" className="u-text-mono u-text-style-xsmall">
                FORCE A VIOLATION
              </label>
              <select
                id="demo"
                className="app_input u-text-style-main"
                value={demo}
                onChange={(e) => setDemo(e.target.value as typeof demo)}
              >
                <option value="">None — normal generation</option>
                <option value="pricing">Pricing overlay (&ldquo;50% OFF&rdquo;)</option>
                <option value="safe_zone">Text in the mobile safe zone</option>
              </select>
              <span className="u-text-style-xsmall" style={{ opacity: 0.45 }}>
                Makes the first attempt deliberately non-compliant so the rejection and
                corrective retry can be shown on demand, instead of waiting for a model to
                misbehave.
              </span>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

export default function GeneratePage() {
  // useSearchParams forces a client bailout, which Next requires a Suspense
  // boundary for at build time.
  return (
    <Suspense fallback={null}>
      <GenerateInner />
    </Suspense>
  );
}
