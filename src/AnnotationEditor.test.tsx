import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotationEditor } from './AnnotationEditor';
import type { InspectTarget } from './types';

function target(): InspectTarget {
  const el = document.createElement('div');
  return {
    comp: 'NavItem',
    loc: 'src/Sidebar.tsx:93:15',
    el,
    // biome-ignore lint/suspicious/noExplicitAny: partial DOMRect is enough for positioning
    rect: { left: 10, top: 10, bottom: 30, right: 50, width: 40, height: 20 } as any
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AnnotationEditor', () => {
  it('submits trimmed name and parsed tags on Save', () => {
    const onSubmit = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('annotation name'), { target: { value: ' пилюля ' } });
    fireEvent.change(screen.getByLabelText('annotation tags'), { target: { value: 'nav, cta ,' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith('пилюля', ['nav', 'cta'], '');
  });

  it('submits on Enter', () => {
    const onSubmit = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const name = screen.getByLabelText('annotation name');
    fireEvent.change(name, { target: { value: 'pill' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('pill', [], '');
  });

  it('does not submit an empty name', () => {
    const onSubmit = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cancels on Esc', () => {
    const onCancel = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText('annotation name'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows an error message when provided', () => {
    render(<AnnotationEditor target={target()} onSubmit={vi.fn()} onCancel={vi.fn()} error="save failed" />);
    expect(screen.getByText('save failed')).toBeTruthy();
  });
});
