import { useEffect } from 'react';

/** Keep fixed overlays inside the screen area left visible by mobile keyboards. */
export function useVisualViewport() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    let animationFrame: number | null = null;

    const update = () => {
      animationFrame = null;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      root.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`);
      root.style.setProperty('--visual-viewport-top', `${Math.round(offsetTop)}px`);
    };

    const scheduleUpdate = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('orientationchange', scheduleUpdate, { passive: true });
    viewport?.addEventListener('resize', scheduleUpdate, { passive: true });
    viewport?.addEventListener('scroll', scheduleUpdate, { passive: true });

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      viewport?.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('scroll', scheduleUpdate);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      root.style.removeProperty('--visual-viewport-height');
      root.style.removeProperty('--visual-viewport-top');
    };
  }, []);
}
