import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useInspector } from './useInspector';

function press(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', init));
}

const HOTKEY: KeyboardEventInit = { key: 's', code: 'KeyS', altKey: true, shiftKey: true };

describe('useInspector', () => {
  it('toggles active on the hotkey', () => {
    const { result } = renderHook(() => useInspector());
    expect(result.current.active).toBe(false);
    act(() => press(HOTKEY));
    expect(result.current.active).toBe(true);
    act(() => press(HOTKEY));
    expect(result.current.active).toBe(false);
  });

  it('Escape deactivates', () => {
    const { result } = renderHook(() => useInspector());
    act(() => press(HOTKEY));
    expect(result.current.active).toBe(true);
    act(() => press({ key: 'Escape' }));
    expect(result.current.active).toBe(false);
  });

  it('ignores non-matching keys', () => {
    const { result } = renderHook(() => useInspector());
    act(() => press({ key: 's', code: 'KeyS', altKey: true }));
    expect(result.current.active).toBe(false);
  });

  it('respects a custom hotkey', () => {
    const { result } = renderHook(() => useInspector({ hotkey: 'Ctrl+I' }));
    act(() => press({ key: 'i', code: 'KeyI', ctrlKey: true }));
    expect(result.current.active).toBe(true);
  });
});
