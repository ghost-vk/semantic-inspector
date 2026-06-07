import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./clipboard', () => ({
  copyText: vi.fn(async () => {}),
  copyElementShot: vi.fn(async () => {})
}));

vi.mock('./annotationClient', () => ({ saveAnnotation: vi.fn() }));

import { saveAnnotation } from './annotationClient';
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

function navTree(): HTMLElement {
  document.body.innerHTML = `<nav data-comp="Sidebar" data-loc="src/Sidebar.tsx:1:1"><button data-comp="NavItem" data-loc="src/Sidebar.tsx:90:5" data-testid="nav-stories">Сюжеты</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button></nav>`;
  return document.querySelectorAll('nav > button')[1] as HTMLElement;
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

  it('forwards the semantic prop so the copied text is the multi-line block', async () => {
    const el = navTree();
    render(<SemanticInspector semantic />);
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(copyText).toHaveBeenCalledWith(
      'NavItem — src/Sidebar.tsx:93:15\ntext: "Рубрики"\nindex: 2/2\npath: Sidebar › NavItem\ntestid: nav-rubrics'
    );
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

const ANNOTATE_KEY: KeyboardEventInit = { key: 'a', code: 'KeyA', altKey: true, shiftKey: true };

function annotatable(): HTMLElement {
  document.body.innerHTML = `<button id="t" data-comp="NavItem" data-loc="src/S.tsx:1:1" data-testid="nav">Рубрики</button>`;
  return document.getElementById('t') as HTMLElement;
}

describe('SemanticInspector — annotate', () => {
  it('opens the editor on click in annotate mode and saves', async () => {
    vi.mocked(saveAnnotation).mockResolvedValue({
      name: 'пилюля',
      anchor: { comp: 'NavItem' },
      lastSeen: { file: null, loc: null },
      createdAt: 't',
      updatedAt: 't'
    });
    const el = annotatable();
    const onAnnotate = vi.fn();
    render(<SemanticInspector annotate onAnnotate={onAnnotate} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ANNOTATE_KEY));
    });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });

    fireEvent.change(screen.getByLabelText('annotation name'), { target: { value: 'пилюля' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(saveAnnotation).toHaveBeenCalledOnce();
    expect(onAnnotate).toHaveBeenCalledWith(expect.objectContaining({ name: 'пилюля' }));
  });

  it('does not wire the annotate hotkey when annotate is not set', () => {
    render(<SemanticInspector />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ANNOTATE_KEY));
    });
    expect(screen.queryByLabelText('annotation name')).toBeNull();
  });
});
