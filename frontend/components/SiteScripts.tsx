'use client';

import { useEffect } from 'react';

// The original page loads these at the end of <body>, in this exact order:
// jQuery + the Webflow runtime first (the motion bundle calls Webflow.env),
// then GSAP with its plugins, then Three/Lenis/Howler/Barba, then the site's
// own motion bundle, which self-initialises via barba.init() and expects the
// full DOM to already exist.
const VENDOR = [
  '/vendor/jquery.min.js',
  '/vendor/webflow.js',
  '/vendor/gsap.min.js',
  '/vendor/scrolltrigger.min.js',
  '/vendor/splittext.min.js',
  '/vendor/customease.min.js',
  '/vendor/flip.min.js',
  '/vendor/three.min.js',
  '/vendor/lenis.min.js',
  '/vendor/howler.min.js',
  '/vendor/barba.umd.js',
];

const MOTION = '/vendor/site-motion.js';

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.body.appendChild(el);
  });
}

let started = false;

export default function SiteScripts() {
  useEffect(() => {
    if (started) return;
    started = true;

    (async () => {
      for (const src of VENDOR) {
        await loadScript(src);
      }

      const w = window as any;
      w.gsap.registerPlugin(w.ScrollTrigger, w.SplitText, w.CustomEase, w.Flip);

      await loadScript(MOTION);
    })().catch((err) => console.error('[monolog] script boot failed', err));
  }, []);

  return null;
}
