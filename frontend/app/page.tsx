import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Hero from '@/components/sections/Hero';
import Problems from '@/components/sections/Problems';
import Gap from '@/components/sections/Gap';
import Works from '@/components/sections/Works';
import Services from '@/components/sections/Services';
import Process from '@/components/sections/Process';
import Faq from '@/components/sections/Faq';
import Cta from '@/components/sections/Cta';

export default function Home() {
  return (
    <div data-barba="container" data-barba-namespace="home" className="page_wrap">
      <Navbar />
      <main className="page_main">
        <Hero />
        <Problems />
        <Gap />
        <Works />
        <Services />
        <Process />
        <Faq />
        <Cta />
        <Footer />
      </main>
    </div>
  );
}
