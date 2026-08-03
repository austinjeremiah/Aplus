import AppNav from '@/components/app/AppNav';
import Hero from '@/components/sections/Hero';

/**
 * Landing page: the template's hero, nothing else. Everything past this point
 * lives in the application routes (dashboard, generate, review, gallery,
 * analytics, verify).
 */
export default function Home() {
  return (
    <div data-barba="container" data-barba-namespace="home" className="page_wrap">
      <link rel="stylesheet" href="/styles/app.css" precedence="high" />
      <AppNav />
      <main className="page_main">
        <Hero />
      </main>
    </div>
  );
}
