import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_SETTLE_MS, useOnlineStatus } from './useOnlineStatus';

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
}

describe('useOnlineStatus', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setOnline(true);
  });

  it('espera a que la reconexión se estabilice antes de anunciar online', () => {
    vi.useFakeTimers();
    setOnline(false);
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(RECONNECT_SETTLE_MS - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('cancela la reconexión pendiente si vuelve a perder la red', () => {
    vi.useFakeTimers();
    setOnline(false);
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(RECONNECT_SETTLE_MS);
    });

    expect(result.current).toBe(false);
  });
});
