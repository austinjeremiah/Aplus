import SiteScripts from '@/components/SiteScripts';
import TransitionScreen from '@/components/TransitionScreen';
import Cursor from '@/components/Cursor';
import AboutModal from '@/components/AboutModal';
import Menu from '@/components/Menu';
import GrainOverlay from '@/components/GrainOverlay';
import FixedUi from '@/components/FixedUi';
import Guides from '@/components/Guides';

/**
 * Marketing shell. The template's overlays (about modal, menu, cursor,
 * transition screen) and its GSAP bundle live here rather than in the root
 * layout, so the application routes inherit neither studio content nor a
 * navbar that only becomes visible after an intro animation has run.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TransitionScreen />
      <Cursor />
      <AboutModal />
      <Menu />
      <GrainOverlay />
      <FixedUi />
      <Guides />
      {children}
      <SiteScripts />
    </>
  );
}
