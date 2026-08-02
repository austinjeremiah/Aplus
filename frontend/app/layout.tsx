import type { Metadata } from 'next';

const description =
  'A++ is a compliance and governance system for Amazon A+ Content image generation. A real rubric against Amazon rules, multi-provider fallback with full retry lineage, dual Backblaze B2 storage, and a public provenance verify page. Built on Genblaze + Backblaze B2.';

export const metadata: Metadata = {
  title: 'A++ | Compliance & Provenance for Amazon A+ Content',
  description,
  openGraph: {
    title: 'A++ | Compliance & Provenance for Amazon A+ Content',
    description,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'A++ | Compliance & Provenance for Amazon A+ Content',
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


        {children}

      </body>
    </html>
  );
}
