import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./clipboard', () => ({
  copyText: vi.fn(async () => {}),
  copyElementShot: vi.fn(async () => {})
}));

import { copyText } from './clipboard';
import { SemanticInspector } from './SemanticInspector';

const HOTKEY: KeyboardEventInit = { key: 's', code: 'KeyS', altKey: true, shiftKey: true };

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', init));
}

function stamped(): HTMLElement {
  document.body.innerHTML = `<div id="t" data-loc="src/Foo.tsx:3:1" data-comp="Foo"></div>`;
  return document.getElementById('t') as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('SemanticInspector', () => {
  it('renders nothing until activated', () => {
    const { container } = render(<SemanticInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the overlay when active and a toast after a copy', async () => {
    const el = stamped();
    render(<SemanticInspector />);
    act(() => press(HOTKEY));
    expect(screen.getByText(/inspect/)).toBeTruthy();

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(screen.getByText(/✓ Foo/)).toBeTruthy();
    expect(copyText).toHaveBeenCalled();
  });

  it('auto-hides the toast after the timeout', async () => {
    vi.useFakeTimers();
    const el = stamped();
    render(<SemanticInspector />);
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(screen.queryByText(/✓ Foo/)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.queryByText(/✓ Foo/)).toBeNull();
  });
});
