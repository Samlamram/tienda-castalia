import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type CollapsibleChromeScroller = 'window' | RefObject<HTMLElement | null>;

export interface UseCollapsibleChromeOptions {
  scroller: CollapsibleChromeScroller;
  enabled: boolean;
  pinned: boolean;
  resetKey: unknown;
  progressive?: boolean;
  travel?: number;
}

export interface UseCollapsibleChromeResult {
  collapsed: boolean;
  offset: number;
  settling: boolean;
  expand: () => void;
  rebaseline: () => void;
}

interface ScrollMetrics {
  top: number;
  maxTop: number;
  hasOverflow: boolean;
}

const ALWAYS_EXPANDED_TOP = 24;
const MINIMUM_COLLAPSE_TOP = 64;
const COLLAPSE_DISTANCE = 32;
const EXPAND_DISTANCE = 12;
const JITTER_DISTANCE = 2;
const CHROME_TRANSITION_MS = 220;
const TRANSITION_SETTLE_BUFFER_MS = 34;
const PROGRESSIVE_SNAP_DELAY_MS = 90;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function readScrollMetrics(scroller: CollapsibleChromeScroller): ScrollMetrics | null {
  if (scroller === 'window') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const root = document.documentElement;
    const body = document.body;
    const scrollHeight = Math.max(
      finiteOrZero(root?.scrollHeight ?? 0),
      finiteOrZero(root?.offsetHeight ?? 0),
      finiteOrZero(root?.clientHeight ?? 0),
      finiteOrZero(body?.scrollHeight ?? 0),
      finiteOrZero(body?.offsetHeight ?? 0),
      finiteOrZero(body?.clientHeight ?? 0),
    );
    const viewportHeight = finiteOrZero(window.innerHeight || root?.clientHeight || 0);
    const maxTop = Math.max(0, scrollHeight - viewportHeight);
    const rawTop = finiteOrZero(window.scrollY ?? window.pageYOffset ?? root?.scrollTop ?? body?.scrollTop ?? 0);

    return {
      top: clamp(rawTop, 0, maxTop),
      maxTop,
      hasOverflow: maxTop > 0,
    };
  }

  const element = scroller.current;
  if (!element) return null;

  const maxTop = Math.max(0, finiteOrZero(element.scrollHeight) - finiteOrZero(element.clientHeight));
  return {
    top: clamp(finiteOrZero(element.scrollTop), 0, maxTop),
    maxTop,
    hasOverflow: maxTop > 0,
  };
}

export function useCollapsibleChrome({
  scroller,
  enabled,
  pinned,
  resetKey,
  progressive = false,
  travel = 144,
}: UseCollapsibleChromeOptions): UseCollapsibleChromeResult {
  const [collapsed, setCollapsed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const collapsedRef = useRef(false);
  const offsetRef = useRef(0);
  const snapTimerRef = useRef<number | null>(null);
  const lastTopRef = useRef(0);
  const directionRef = useRef<-1 | 0 | 1>(0);
  const distanceRef = useRef(0);
  const microDirectionRef = useRef<-1 | 0 | 1>(0);
  const microDistanceRef = useRef(0);
  const transitionActiveRef = useRef(false);
  const transitionTimerRef = useRef<number | null>(null);
  const rebaselineRef = useRef<() => void>(() => undefined);

  const beginTransitionSuppression = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }

    let reducedMotion = false;
    try {
      reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      // Embedded browsers can expose matchMedia before it is usable. Falling
      // back to the regular duration keeps the guard active long enough.
      reducedMotion = false;
    }

    transitionActiveRef.current = true;
    const settleDelay = reducedMotion ? 0 : CHROME_TRANSITION_MS + TRANSITION_SETTLE_BUFFER_MS;
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      transitionActiveRef.current = false;
      rebaselineRef.current();
    }, settleDelay);
  }, []);

  const updateCollapsed = useCallback((nextCollapsed: boolean) => {
    if (collapsedRef.current === nextCollapsed) return;

    collapsedRef.current = nextCollapsed;
    beginTransitionSuppression();
    setCollapsed(nextCollapsed);
  }, [beginTransitionSuppression]);

  const resetTracking = useCallback((metrics: ScrollMetrics | null) => {
    lastTopRef.current = metrics?.top ?? 0;
    directionRef.current = 0;
    distanceRef.current = 0;
    microDirectionRef.current = 0;
    microDistanceRef.current = 0;
  }, []);

  const rebaseline = useCallback(() => {
    const metrics = readScrollMetrics(scroller);
    resetTracking(metrics);

    if (!metrics?.hasOverflow) {
      updateCollapsed(false);
    }
  }, [resetTracking, scroller, updateCollapsed]);

  useEffect(() => {
    rebaselineRef.current = rebaseline;
  }, [rebaseline]);

  const expand = useCallback(() => {
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
    offsetRef.current = 0;
    setOffset(0);
    setSettling(false);
    updateCollapsed(false);
    resetTracking(readScrollMetrics(scroller));
  }, [resetTracking, scroller, updateCollapsed]);

  useEffect(() => {
    // A context change (screen/user), a pin transition, or enabling/disabling the
    // mobile behavior starts from a predictable, fully expanded state.
    expand();
  }, [enabled, expand, pinned, resetKey]);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    transitionActiveRef.current = false;
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (progressive || !enabled || pinned || typeof window === 'undefined') return;

    const target = scroller === 'window' ? window : scroller.current;
    if (!target) {
      expand();
      return;
    }

    const initialMetrics = readScrollMetrics(scroller);
    resetTracking(initialMetrics);
    if (!initialMetrics?.hasOverflow) updateCollapsed(false);

    let animationFrame: number | null = null;

    const processScroll = () => {
      animationFrame = null;
      const metrics = readScrollMetrics(scroller);

      // Animating the header slot changes document geometry. Some browsers
      // repeatedly compensate scrollTop while its height transitions, which
      // otherwise looks like alternating user gestures and feeds back into the
      // collapsed state. The settling timer rebaselines at the final layout.
      if (transitionActiveRef.current) return;

      if (!metrics?.hasOverflow) {
        updateCollapsed(false);
        resetTracking(metrics);
        return;
      }

      const currentTop = metrics.top;
      const delta = currentTop - lastTopRef.current;
      lastTopRef.current = currentTop;

      if (currentTop <= ALWAYS_EXPANDED_TOP) {
        updateCollapsed(false);
        resetTracking(metrics);
        return;
      }

      if (delta === 0) return;

      let effectiveDelta = delta;
      if (Math.abs(delta) < JITTER_DISTANCE) {
        const microDirection: -1 | 1 = delta > 0 ? 1 : -1;
        if (microDirectionRef.current !== microDirection) {
          microDirectionRef.current = microDirection;
          microDistanceRef.current = 0;
        }
        microDistanceRef.current += Math.abs(delta);
        if (microDistanceRef.current < JITTER_DISTANCE) return;

        effectiveDelta = microDirection * microDistanceRef.current;
        microDirectionRef.current = 0;
        microDistanceRef.current = 0;
      } else {
        microDirectionRef.current = 0;
        microDistanceRef.current = 0;
      }

      const nextDirection: -1 | 1 = effectiveDelta > 0 ? 1 : -1;
      if (directionRef.current !== nextDirection) {
        directionRef.current = nextDirection;
        distanceRef.current = 0;
      }
      distanceRef.current += Math.abs(effectiveDelta);

      if (nextDirection === 1) {
        if (
          !collapsedRef.current
          && currentTop >= MINIMUM_COLLAPSE_TOP
          && distanceRef.current >= COLLAPSE_DISTANCE
        ) {
          updateCollapsed(true);
          resetTracking(metrics);
        }
        return;
      }

      if (collapsedRef.current && distanceRef.current >= EXPAND_DISTANCE) {
        updateCollapsed(false);
        resetTracking(metrics);
      }
    };

    const handleScroll = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(processScroll);
    };

    target.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      target.removeEventListener('scroll', handleScroll);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [enabled, expand, pinned, progressive, resetTracking, scroller, updateCollapsed]);

  useEffect(() => {
    if (!progressive || !enabled || pinned || typeof window === 'undefined') return;

    const target = scroller === 'window' ? window : scroller.current;
    if (!target) {
      expand();
      return;
    }

    const initialMetrics = readScrollMetrics(scroller);
    lastTopRef.current = initialMetrics?.top ?? 0;
    if (!initialMetrics?.hasOverflow) {
      expand();
      return;
    }

    let animationFrame: number | null = null;
    const settle = () => {
      if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
      if (offsetRef.current <= 0 || offsetRef.current >= travel) return;

      snapTimerRef.current = window.setTimeout(() => {
        snapTimerRef.current = null;
        const targetOffset = offsetRef.current >= travel / 2 ? travel : 0;
        offsetRef.current = targetOffset;
        setSettling(true);
        setOffset(targetOffset);
        updateCollapsed(targetOffset === travel);
      }, PROGRESSIVE_SNAP_DELAY_MS);
    };

    const processScroll = () => {
      animationFrame = null;
      const metrics = readScrollMetrics(scroller);
      if (!metrics?.hasOverflow) {
        expand();
        return;
      }

      const currentTop = metrics.top;
      const delta = currentTop - lastTopRef.current;
      lastTopRef.current = currentTop;

      if (currentTop <= ALWAYS_EXPANDED_TOP) {
        offsetRef.current = 0;
        setSettling(false);
        setOffset(0);
        updateCollapsed(false);
        return;
      }
      if (delta === 0) return;

      if (delta < 0 && collapsedRef.current) updateCollapsed(false);

      const nextOffset = clamp(offsetRef.current + delta, 0, travel);
      if (nextOffset === offsetRef.current) return;
      offsetRef.current = nextOffset;
      setSettling(false);
      setOffset(nextOffset);
      if (nextOffset === 0) updateCollapsed(false);
      if (nextOffset === travel) updateCollapsed(true);
      settle();
    };

    const handleScroll = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(processScroll);
    };

    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', handleScroll);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      if (snapTimerRef.current !== null) {
        window.clearTimeout(snapTimerRef.current);
        snapTimerRef.current = null;
      }
    };
  }, [enabled, expand, pinned, progressive, scroller, travel, updateCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    viewport.addEventListener('resize', rebaseline);
    return () => viewport.removeEventListener('resize', rebaseline);
  }, [rebaseline]);

  return { collapsed, offset, settling, expand, rebaseline };
}
