import type { Metadata } from 'next';
import { AuthProvider } from '@/components/auth/AuthProvider';
import Cursor from '@/components/Cursor';

const description =
  'A+ Foundry is the production system behind AI-generated Amazon A+ Content: a real compliance rubric against Amazon rules, multi-provider fallback with full retry lineage, dual Backblaze B2 storage, and provenance anyone can verify. Built with Genblaze on Backblaze B2.';

export const metadata: Metadata = {
  title: 'A+ Foundry | Compliance & Provenance for Amazon A+ Content',
  description,
  openGraph: {
    title: 'A+ Foundry | Compliance & Provenance for Amazon A+ Content',
    description,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'A+ Foundry | Compliance & Provenance for Amazon A+ Content',
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

        {/* The template's animated film-grain overlay is deliberately not
            mounted. It is a fixed, full-viewport layer in color-dodge at the
            maximum z-index, which lifts black surfaces to a muddy grey and
            smears every table and small-caps label underneath it. Fine over a
            marketing hero, wrong over dense operational data. */}
        <Cursor />

        <AuthProvider>{children}</AuthProvider>

      </body>
    </html>
  );
}
