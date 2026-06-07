import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInspector } from './useInspector';

vi.mock('./clipboard', () => ({
  copyText: vi.fn(async () => {}),
  copyElementShot: vi.fn(async () => {})
}));

import { copyElementShot, copyText } from './clipboard';

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', init));
}

const HOTKEY: KeyboardEventInit = { key: 's', code: 'KeyS', altKey: true, shiftKey: true };

function stamped(): HTMLElement {
  document.body.innerHTML = `<div id="t" data-loc="src/Foo.tsx:3:1" data-comp="Foo"></div>`;
  return document.getElementById('t') as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('useInspector — hotkey', () => {
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

  it('respects a custom letter hotkey', () => {
    const { result } = renderHook(() => useInspector({ hotkey: 'Ctrl+I' }));
    act(() => press({ key: 'i', code: 'KeyI', ctrlKey: true }));
    expect(result.current.active).toBe(true);
  });

  it('matches a digit hotkey (Alt+1)', () => {
    const { result } = renderHook(() => useInspector({ hotkey: 'Alt+1' }));
    act(() => press({ key: '1', code: 'Digit1', altKey: true }));
    expect(result.current.active).toBe(true);
  });

  it('matches a shifted-symbol hotkey (Ctrl+Shift+/) via event.code', () => {
    const { result } = renderHook(() => useInspector({ hotkey: 'Ctrl+Shift+/' }));
    act(() => press({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }));
    expect(result.current.active).toBe(true);
  });
});

describe('useInspector — click', () => {
  it('plain click copies formatted text, intercepts the event, and fires onCopy', async () => {
    const el = stamped();
    const onCopy = vi.fn();
    renderHook(() => useInspector({ onCopy }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 });
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(copyText).toHaveBeenCalledWith('Foo — src/Foo.tsx:3:1');
    expect(ev.defaultPrevented).toBe(true);
    expect(onCopy).toHaveBeenCalledWith('text', 'Foo — src/Foo.tsx:3:1');
  });

  it('Shift+click copies a screenshot, not text', async () => {
    const el = stamped();
    renderHook(() => useInspector());
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true, clientX: 1, clientY: 1 })
      );
    });
    expect(copyElementShot).toHaveBeenCalledOnce();
    expect(copyText).not.toHaveBeenCalled();
  });

  it('does not intercept clicks on unresolvable targets', () => {
    renderHook(() => useInspector());
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    const ev = new MouseEvent('click', { cancelable: true, clientX: 1, clientY: 1 });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('routes a failure to onError', async () => {
    const el = stamped();
    vi.mocked(copyText).mockRejectedValueOnce(new Error('boom'));
    const onError = vi.fn();
    renderHook(() => useInspector({ onError }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(onError).toHaveBeenCalledWith('text', expect.any(Error));
  });
});
