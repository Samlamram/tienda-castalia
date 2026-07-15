import { useEffect } from 'react';

let lockCount = 0;
let previousBodyStyle: Partial<CSSStyleDeclaration> | null = null;
let previousHtmlStyle: Partial<CSSStyleDeclaration> | null = null;

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof window === 'undefined' || typeof document === 'undefined') return;

    const body = document.body;
    const html = document.documentElement;

    if (lockCount === 0) {
      const scrollbarGap = window.innerWidth - html.clientWidth;

      previousBodyStyle = {
        overflow: body.style.overflow,
        paddingRight: body.style.paddingRight,
      };
      previousHtmlStyle = {
        overflow: html.style.overflow,
        overscrollBehavior: html.style.overscrollBehavior,
      };

      html.classList.add('modal-scroll-locked');
      body.classList.add('modal-scroll-locked');
      html.style.overflow = 'hidden';
      html.style.overscrollBehavior = 'none';
      body.style.overflow = 'hidden';

      if (scrollbarGap > 0) {
        body.style.paddingRight = `${scrollbarGap}px`;
      }
    }

    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount > 0) return;

      html.classList.remove('modal-scroll-locked');
      body.classList.remove('modal-scroll-locked');

      if (previousHtmlStyle) {
        html.style.overflow = previousHtmlStyle.overflow ?? '';
        html.style.overscrollBehavior = previousHtmlStyle.overscrollBehavior ?? '';
      }

      if (previousBodyStyle) {
        body.style.overflow = previousBodyStyle.overflow ?? '';
        body.style.paddingRight = previousBodyStyle.paddingRight ?? '';
      }

      previousBodyStyle = null;
      previousHtmlStyle = null;
    };
  }, [locked]);
}

