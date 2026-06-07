import { afterEach, describe, expect, it } from 'vitest';
import { buildAnnotation } from './buildAnnotation';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('buildAnnotation', () => {
  it('builds an input from a stamped element, reusing extractSemantics', () => {
    document.body.innerHTML = `<nav data-comp="Sidebar"><button id="b" data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:99:9">x</button></nav>`;
    const el = document.getElementById('b') as Element;
    const out = buildAnnotation(el, '  пилюля  ', ['nav'], '  note ');
    expect(out.name).toBe('пилюля');
    expect(out.tags).toEqual(['nav']);
    expect(out.note).toBe('note');
    expect(out.anchor.comp).toBe('NavItem');
    expect(out.anchor.text).toBe('Рубрики');
    expect(out.anchor.attrs).toMatchObject({ 'data-testid': 'nav-rubrics' });
    expect(out.lastSeen).toEqual({ file: 'src/Sidebar.tsx', loc: 'src/Sidebar.tsx:93:15' });
  });

  it('drops empty tags/note and nulls lastSeen for an unstamped element', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const out = buildAnnotation(document.getElementById('b') as Element, 'x', [], '');
    expect(out.tags).toBeUndefined();
    expect(out.note).toBeUndefined();
    expect(out.lastSeen).toEqual({ file: null, loc: null });
  });
});
