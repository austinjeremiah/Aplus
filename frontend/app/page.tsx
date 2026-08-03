import Hero from '@/components/sections/Hero';
import GoogleLogin from '@/components/auth/GoogleLogin';

/**
 * Landing: the hero, and nothing else. No navbar, no sections, no footer —
 * the app itself lives behind the Google sign-in on this page.
 */
export default function Home() {
  return (
    <div data-barba="container" data-barba-namespace="home" className="page_wrap">
      <GoogleLogin />
      <main className="page_main">
        <Hero />
      </main>
    </div>
  );
}
