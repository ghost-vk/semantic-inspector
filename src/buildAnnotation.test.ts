import { afterEach, describe, expect, it } from 'vitest';
import { buildAnnotation, captureAnchor } from './buildAnnotation';
import type { AnnotationDraft, InspectTarget } from './types';

afterEach(() => {
  document.body.innerHTML = '';
});

// A draft as useInspector builds it at click time; target geometry is irrelevant to the assembler.
function draftFor(el: Element): AnnotationDraft {
  const { anchor, lastSeen } = captureAnchor(el);
  const target: InspectTarget = { el, comp: anchor.comp, loc: lastSeen.loc, rect: {} as DOMRect };
  return { target, anchor, lastSeen };
}

describe('captureAnchor', () => {
  it('captures the descriptor + lastSeen from a stamped element, reusing extractSemantics', () => {
    document.body.innerHTML = `<nav data-comp="Sidebar"><button id="b" data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:99:9">x</button></nav>`;
    const el = document.getElementById('b') as Element;
    const { anchor, lastSeen } = captureAnchor(el);
    expect(anchor.comp).toBe('NavItem');
    expect(anchor.text).toBe('Рубрики');
    expect(anchor.attrs).toMatchObject({ 'data-testid': 'nav-rubrics' });
    expect(lastSeen).toEqual({ file: 'src/Sidebar.tsx', loc: 'src/Sidebar.tsx:93:15' });
  });

  it('nulls lastSeen for an unstamped element', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    expect(captureAnchor(document.getElementById('b') as Element).lastSeen).toEqual({ file: null, loc: null });
  });
});

describe('buildAnnotation', () => {
  it('assembles the captured anchor + editor fields; trims and is pure (no DOM re-read)', () => {
    document.body.innerHTML = `<button id="b" data-comp="NavItem" data-loc="src/S.tsx:1:1" data-testid="nav">Рубрики</button>`;
    const el = document.getElementById('b') as Element;
    const draft = draftFor(el);
    // Mutate the DOM AFTER capture: the assembler must serialize the snapshot, not re-read.
    el.setAttribute('data-comp', 'Renamed');
    const out = buildAnnotation(draft, '  пилюля  ', ['nav'], '  note ');
    expect(out.name).toBe('пилюля');
    expect(out.tags).toEqual(['nav']);
    expect(out.note).toBe('note');
    expect(out.anchor.comp).toBe('NavItem'); // the click-time value, not the later 'Renamed'
    expect(out.lastSeen).toEqual({ file: 'src/S.tsx', loc: 'src/S.tsx:1:1' });
  });

  it('drops empty tags/note', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const out = buildAnnotation(draftFor(document.getElementById('b') as Element), 'x', [], '');
    expect(out.tags).toBeUndefined();
    expect(out.note).toBeUndefined();
  });
});
