'use client';

/**
 * Shared primitives for every app page.
 *
 * Typography, buttons and eyebrows reuse the template's own classes
 * (u-text-style-*, g_btn_*, g_eyebrow) so the app reads as one system with
 * the marketing site. Only structural layout comes from app.css.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { assetSrc, type Compliance, type Run, type Violation } from '@/lib/api';

/* ------------------------------------------------------------------ */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div data-wf--global-eyebrow--variant="base" className="g_eyebrow">
      <div className="g_eyebrow_circle" />
      <div className="g_eyebrow_text u-text-style-large">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const ARROW = (
  <svg width="100%" viewBox="0 0 12 12" fill="none" className="g_btn_svg" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8.90954 9.09046L9 3L2.90954 3.09046L2.90213 4.32367L6.86437 4.25391L2.55914 8.55914L3.44086 9.44086L7.74609 5.13563L7.68708 9.10862L8.90954 9.09046Z"
      fill="currentColor"
    />
  </svg>
);

function ButtonInner({ label }: { label: ReactNode }) {
  return (
    <>
      <div className="g_btn_text_contain">
        <div className="g_btn_text u-text-style-small u-text-trim-off">{label}</div>
      </div>
      <div className="g_btn_aside_wrap">
        <div className="g_btn_aside_bg" />
        {ARROW}
      </div>
    </>
  );
}

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} data-btn-default="" className="g_btn_main w-inline-block">
      <ButtonInner label={children} />
    </Link>
  );
}

export function ButtonAnchor({ href, children, download }: { href: string; children: ReactNode; download?: boolean }) {
  return (
    <a href={href} download={download} data-btn-default="" className="g_btn_main w-inline-block">
      <ButtonInner label={children} />
    </a>
  );
}

export function Button({
  onClick,
  children,
  disabled,
  type = 'button',
}: {
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-btn-default=""
      className="g_btn_main w-inline-block"
      style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
    >
      <ButtonInner label={children} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
type Tone = 'is-pass' | 'is-fail' | 'is-warn' | 'is-idle';

const STATUS_TONE: Record<string, Tone> = {
  passed: 'is-pass',
  approved: 'is-pass',
  complete: 'is-pass',
  generated: 'is-idle',
  queued: 'is-idle',
  in_progress: 'is-warn',
  needs_review: 'is-warn',
  failed: 'is-fail',
  rejected: 'is-fail',
  provider_failed: 'is-fail',
  not_found: 'is-idle',
};

const STATUS_LABEL: Record<string, string> = {
  passed: 'Compliant',
  approved: 'Approved',
  generated: 'Generated',
  needs_review: 'Needs review',
  failed: 'Rejected',
  rejected: 'Rejected',
  provider_failed: 'Provider failed',
  queued: 'Queued',
  in_progress: 'Generating',
  complete: 'Complete',
  not_found: 'Not found',
};

/** One consistent status vocabulary across every page. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = status ?? 'idle';
  const tone = STATUS_TONE[key] ?? 'is-idle';
  return (
    <span className={`app_badge ${tone} u-text-mono u-text-style-xsmall`}>
      <span className="app_badge_dot" />
      {STATUS_LABEL[key] ?? key}
    </span>
  );
}

export function ComplianceBadge({ compliance }: { compliance: Compliance | null }) {
  if (!compliance) return <StatusBadge status="generated" />;
  const n = compliance.violations.filter((v) => v.severity === 'error').length;
  const label =
    compliance.status === 'passed'
      ? 'Compliant'
      : compliance.status === 'needs_review'
        ? 'Needs review'
        : `${n} violation${n === 1 ? '' : 's'}`;
  const tone: Tone =
    compliance.status === 'passed' ? 'is-pass' : compliance.status === 'needs_review' ? 'is-warn' : 'is-fail';
  return (
    <span className={`app_badge ${tone} u-text-mono u-text-style-xsmall`}>
      <span className="app_badge_dot" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
export function Violations({ items }: { items: Violation[] }) {
  if (!items.length) return null;
  return (
    <div>
      {items.map((v, i) => (
        <div
          key={`${v.rule}-${i}`}
          className="app_violation"
          style={{ color: v.severity === 'error' ? '#ef6a5f' : '#e2b04a' }}
        >
          <div className="u-text-mono u-text-style-xsmall">{v.rule.replace(/_/g, ' ')}</div>
          <div className="u-text-style-small" style={{ opacity: 0.85 }}>
            {v.evidence}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="app_stat">
      <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.55 }}>
        {label}
      </div>
      <div className="u-text-style-h4 app_stat_value">{value}</div>
      {hint ? (
        <div className="u-text-style-xsmall" style={{ opacity: 0.5 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="app_head">
      <div className="app_stack">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.5rem' }}>
          {title}
        </h1>
        {lede ? (
          <p className="u-text-style-main u-max-width-60ch" style={{ opacity: 0.6 }}>
            {lede}
          </p>
        ) : null}
      </div>
      {actions ? <div className="app_head_actions">{actions}</div> : null}
    </header>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="app_empty">
      <div className="u-text-style-h5">{title}</div>
      {body ? (
        <p className="u-text-style-main u-max-width-50ch" style={{ opacity: 0.55, margin: '0.75rem auto 0' }}>
          {body}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'center' }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="app_error">
      <div className="u-text-mono u-text-style-xsmall">ERROR</div>
      <div className="u-text-style-main">{message}</div>
      {onRetry ? (
        <button onClick={onRetry} className="u-text-style-small" style={{ marginTop: '0.6rem', textDecoration: 'underline' }}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ h = '1rem', w = '100%' }: { h?: string; w?: string }) {
  return <div className="app_skeleton" style={{ height: h, width: w }} />;
}

export function SkeletonGrid({ n = 6 }: { n?: number }) {
  return (
    <div className="app_grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="app_card">
          <Skeleton h="9rem" />
          <div className="app_card_body">
            <Skeleton h="0.8rem" w="60%" />
            <Skeleton h="0.8rem" w="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function AssetCard({ run }: { run: Run }) {
  return (
    <Link href={`/runs/${run.run_id}`} className="app_card">
      <div className="app_card_media">
        {run.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetSrc(run.asset_url)} alt={`${run.asin} ${run.module_id}`} loading="lazy" />
        ) : null}
      </div>
      <div className="app_card_body">
        <div className="app_row" style={{ justifyContent: 'space-between' }}>
          <span className="u-text-mono u-text-style-xsmall">{run.asin}</span>
          <StatusBadge status={run.status} />
        </div>
        <div className="u-text-style-small" style={{ opacity: 0.6 }}>
          {run.module_id.replace(/_/g, ' ')}
        </div>
        <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.4 }}>
          {run.provider ?? 'unknown'}
          {run.duplicate_count && run.duplicate_count > 1 ? ` · ${run.duplicate_count}× deduped` : ''}
        </div>
      </div>
    </Link>
  );
}
