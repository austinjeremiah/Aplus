import AppNav from '@/components/app/AppNav';
import GrainOverlay from '@/components/GrainOverlay';

/**
 * Shell for every application route. The marketing landing page keeps the
 * template's own layout; app pages get the same body/theme attributes so the
 * shared cascade (fonts, grain, cursor) still applies.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-barba="container" data-barba-namespace="app" className="page_wrap u-theme-dark">
      <link rel="stylesheet" href="/styles/app.css" precedence="high" />
      <GrainOverlay />
      <AppNav />
      <main className="page_main app_main">
        <div className="app_container">{children}</div>
      </main>
    </div>
  );
}
