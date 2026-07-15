import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollapsibleChrome } from './useCollapsibleChrome';

interface ScrollFixture {
  element: HTMLDivElement;
  metrics: {
    top: number;
    scrollHeight: number;
    clientHeight: number;
  };
}

let nextAnimationFrameId = 1;
let animationFrames = new Map<number, FrameRequestCallback>();

function createScroller({
  top = 0,
  scrollHeight = 1_000,
  clientHeight = 200,
}: Partial<ScrollFixture['metrics']> = {}): ScrollFixture {
  const element = document.createElement('div');
  const metrics = { top, scrollHeight, clientHeight };

  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: () => metrics.top,
      set: (value: number) => {
        metrics.top = Number(value);
      },
    },
    scrollHeight: {
      configurable: true,
      get: () => metrics.scrollHeight,
    },
    clientHeight: {
      configurable: true,
      get: () => metrics.clientHeight,
    },
  });

  return { element, metrics };
}

function flushAnimationFrames(): void {
  const pending = [...animationFrames.values()];
  animationFrames.clear();
  act(() => {
    pending.forEach((callback) => callback(0));
  });
}

function emitScroll(fixture: ScrollFixture, top: number): void {
  act(() => {
    fixture.element.scrollTop = top;
    fixture.element.dispatchEvent(new Event('scroll'));
  });
  flushAnimationFrames();
}

function settleChromeTransition(): void {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

describe('useCollapsibleChrome', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nextAnimationFrameId = 1;
    animationFrames = new Map();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId++;
        animationFrames.set(id, callback);
        return id;
      }),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((id: number) => {
        animationFrames.delete(id);
      }),
    });
  });

  afterEach(() => {
    cleanup();
    animationFrames.clear();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('no colapsa antes de 64 px aunque ya haya recorrido 32 px hacia abajo', () => {
    const fixture = createScroller();
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    emitScroll(fixture, 20);
    emitScroll(fixture, 40);
    emitScroll(fixture, 60);
    expect(result.current.collapsed).toBe(false);

    emitScroll(fixture, 64);
    expect(result.current.collapsed).toBe(true);
  });

  it('acumula el scroll lento hasta completar los 32 px de contraccion', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    for (let top = 66; top < 96; top += 2) {
      emitScroll(fixture, top);
      expect(result.current.collapsed).toBe(false);
    }
    emitScroll(fixture, 96);

    expect(result.current.collapsed).toBe(true);
  });

  it('acumula desplazamientos continuos menores de 2 px sin perder scroll lento', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    for (let top = 65; top <= 96; top += 1) {
      emitScroll(fixture, top);
    }

    expect(result.current.collapsed).toBe(true);
  });

  it('ignora jitter alternante menor de 2 px', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    for (let index = 0; index < 40; index += 1) {
      emitScroll(fixture, index % 2 === 0 ? 65 : 64);
    }

    expect(result.current.collapsed).toBe(false);
  });

  it('vuelve a expandirse al acumular 12 px hacia arriba', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    emitScroll(fixture, 96);
    expect(result.current.collapsed).toBe(true);
    settleChromeTransition();

    emitScroll(fixture, 92);
    emitScroll(fixture, 88);
    emitScroll(fixture, 85);
    expect(result.current.collapsed).toBe(true);

    emitScroll(fixture, 83);
    expect(result.current.collapsed).toBe(false);
  });

  it('permanece expandido y deja de observar scroll mientras esta pinned', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result, rerender } = renderHook(
      ({ pinned }) => useCollapsibleChrome({
        scroller,
        enabled: true,
        pinned,
        resetKey: 'catalogo',
      }),
      { initialProps: { pinned: false } },
    );

    emitScroll(fixture, 96);
    expect(result.current.collapsed).toBe(true);

    rerender({ pinned: true });
    expect(result.current.collapsed).toBe(false);

    emitScroll(fixture, 160);
    expect(result.current.collapsed).toBe(false);
    expect(animationFrames.size).toBe(0);
  });

  it('expande y recalibra cuando cambia resetKey', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result, rerender } = renderHook(
      ({ resetKey }) => useCollapsibleChrome({
        scroller,
        enabled: true,
        pinned: false,
        resetKey,
      }),
      { initialProps: { resetKey: 'usuario-a' } },
    );

    emitScroll(fixture, 96);
    expect(result.current.collapsed).toBe(true);

    rerender({ resetKey: 'usuario-b' });
    expect(result.current.collapsed).toBe(false);
    settleChromeTransition();

    emitScroll(fixture, 128);
    expect(result.current.collapsed).toBe(true);
  });

  it('fuerza el estado expandido si el contenido deja de tener overflow', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    emitScroll(fixture, 96);
    expect(result.current.collapsed).toBe(true);

    fixture.metrics.scrollHeight = fixture.metrics.clientHeight;
    emitScroll(fixture, 200);
    settleChromeTransition();

    expect(result.current.collapsed).toBe(false);
  });

  it('permanece expandido cuando el comportamiento movil esta deshabilitado', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: false,
      pinned: false,
      resetKey: 'desktop',
    }));

    emitScroll(fixture, 160);

    expect(result.current.collapsed).toBe(false);
  });

  it('limita el overscroll y expande al volver al borde superior', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    emitScroll(fixture, 96);
    expect(result.current.collapsed).toBe(true);
    settleChromeTransition();

    emitScroll(fixture, -80);
    expect(result.current.collapsed).toBe(false);
  });

  it('reinicia la distancia acumulada al cambiar de direccion', () => {
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'catalogo',
    }));

    emitScroll(fixture, 80);
    emitScroll(fixture, 72);
    emitScroll(fixture, 90);
    expect(result.current.collapsed).toBe(false);

    emitScroll(fixture, 104);
    expect(result.current.collapsed).toBe(true);
  });

  it('ignora el scroll inducido por layout hasta que termina la transicion', () => {
    const fixture = createScroller({ top: 209 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'administracion',
    }));

    emitScroll(fixture, 241);
    expect(result.current.collapsed).toBe(true);

    // Replica la oscilacion 209 <-> 261 observada mientras el slot cambia de
    // altura. Estos saltos pertenecen al layout, no a una nueva intencion.
    emitScroll(fixture, 261);
    emitScroll(fixture, 209);
    emitScroll(fixture, 261);
    emitScroll(fixture, 209);
    expect(result.current.collapsed).toBe(true);

    settleChromeTransition();
    emitScroll(fixture, 197);
    expect(result.current.collapsed).toBe(false);
  });

  it('recalibra sin espera animada cuando se prefiere movimiento reducido', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const fixture = createScroller({ top: 64 });
    const scroller = { current: fixture.element };
    const { result } = renderHook(() => useCollapsibleChrome({
      scroller,
      enabled: true,
      pinned: false,
      resetKey: 'administracion',
    }));

    emitScroll(fixture, 96);
    expect(result.current.collapsed).toBe(true);

    emitScroll(fixture, 84);
    expect(result.current.collapsed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(0);
    });
    emitScroll(fixture, 72);
    expect(result.current.collapsed).toBe(false);
  });
});
