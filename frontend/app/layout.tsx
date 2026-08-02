import type { Metadata } from 'next';
import SiteScripts from '@/components/SiteScripts';
import TransitionScreen from '@/components/TransitionScreen';
import Cursor from '@/components/Cursor';
import AboutModal from '@/components/AboutModal';
import Menu from '@/components/Menu';
import GrainOverlay from '@/components/GrainOverlay';
import FixedUi from '@/components/FixedUi';
import Guides from '@/components/Guides';

const description =
  'We building change-making branding and websites for established creative brands who refuse to be underestimated. Trusted by OH Architecture, Vinamilk, and many other leading brands.';

export const metadata: Metadata = {
  title: 'MONOLOG | Brand and Web Design Studio founded By Huy',
  description,
  openGraph: {
    title: 'MONOLOG | Brand and Web Design Studio founded By Huy',
    description,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MONOLOG | Brand and Web Design Studio founded By Huy',
    description,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="lenis">
      <body
        className="body"
        data-barba="wrapper"
        data-navigation-status="is-close"
        data-about-status="is-closed"
        data-theme-nav="dark"
        data-scroll-time="0"
      >
        {/* Served verbatim from /public so the compiled Webflow cascade is
            byte-identical to the original; React hoists these into <head>. */}
        <link rel="stylesheet" href="/styles/webflow.css" precedence="high" />
        <link rel="stylesheet" href="/styles/inline.css" precedence="high" />

        <TransitionScreen />
        <Cursor />
        <AboutModal />
        <Menu />
        <GrainOverlay />
        <FixedUi />
        <Guides />

        {children}

        <SiteScripts />
      </body>
    </html>
  );
}
