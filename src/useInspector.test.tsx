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

function navTree(): HTMLElement {
  document.body.innerHTML = `<nav data-comp="Sidebar" data-loc="src/Sidebar.tsx:1:1"><button data-comp="NavItem" data-loc="src/Sidebar.tsx:90:5" data-testid="nav-stories">Сюжеты</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button></nav>`;
  return document.querySelectorAll('nav > button')[1] as HTMLElement;
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

describe('useInspector — semantic', () => {
  it('semantic=false copies the one-line default', async () => {
    const el = stamped();
    renderHook(() => useInspector({ semantic: false }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(copyText).toHaveBeenCalledWith('Foo — src/Foo.tsx:3:1');
  });

  it('semantic=true copies the multi-line block', async () => {
    const el = navTree();
    renderHook(() => useInspector({ semantic: true }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(copyText).toHaveBeenCalledWith(
      'NavItem — src/Sidebar.tsx:93:15\ntext: "Рубрики"\nindex: 2/2\npath: Sidebar › NavItem\ntestid: nav-rubrics'
    );
  });

  it('passes the SemanticInfo object to a custom formatText when semantic is on', async () => {
    const el = navTree();
    const formatText = vi.fn((t) => `${t.comp}:${t.text}:${t.index}/${t.total}`);
    renderHook(() => useInspector({ semantic: true, formatText }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(formatText).toHaveBeenCalledWith(
      expect.objectContaining({ comp: 'NavItem', text: 'Рубрики', index: 2, total: 2 })
    );
    expect(copyText).toHaveBeenCalledWith('NavItem:Рубрики:2/2');
  });
});

const ANNOTATE: KeyboardEventInit = { key: 'a', code: 'KeyA', altKey: true, shiftKey: true };

describe('useInspector — annotate mode', () => {
  it('annotate hotkey toggles annotate mode only when annotate is enabled', () => {
    const off = renderHook(() => useInspector({ annotate: false }));
    act(() => press(ANNOTATE));
    expect(off.result.current.mode).toBe('off');

    const on = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    expect(on.result.current.mode).toBe('annotate');
    expect(on.result.current.active).toBe(true);
  });

  it('clicking in annotate mode opens a draft and does not copy', async () => {
    const el = navTree();
    const { result } = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(result.current.draft?.target.el).toBe(el);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('closeDraft clears the draft', async () => {
    const el = navTree();
    const { result } = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    act(() => result.current.closeDraft());
    expect(result.current.draft).toBeNull();
  });

  it('captures the anchor at click time, not at save time (TOCTOU)', async () => {
    const el = navTree();
    const { result } = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(result.current.draft?.anchor.comp).toBe('NavItem');
    // The DOM changes while the editor is open; the captured snapshot must not follow it.
    el.setAttribute('data-comp', 'Renamed');
    expect(result.current.draft?.anchor.comp).toBe('NavItem');
  });
});
