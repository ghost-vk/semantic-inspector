import { afterEach, describe, expect, it } from 'vitest';
import { extractSemantics } from './extractSemantics';

const el = (id: string): Element => document.getElementById(id) as Element;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('extractSemantics — text', () => {
  it('collapses whitespace and trims the visible label', () => {
    document.body.innerHTML = `<button id="b" data-comp="Btn">  Save\n  changes </button>`;
    expect(extractSemantics(el('b')).text).toBe('Save changes');
  });

  it('truncates at 160 chars with an ellipsis', () => {
    document.body.innerHTML = `<button id="b" data-comp="Btn">${'x'.repeat(200)}</button>`;
    const t = extractSemantics(el('b')).text as string;
    expect(t.length).toBe(161);
    expect(t.endsWith('…')).toBe(true);
  });

  it('truncates on a code-point boundary without splitting a surrogate pair', () => {
    // Cap falls inside the emoji run; a UTF-16 slice would leave a lone surrogate.
    document.body.innerHTML = `<button id="b" data-comp="Btn">${'x'.repeat(159)}${'😀'.repeat(5)}</button>`;
    const t = extractSemantics(el('b')).text as string;
    expect(t.endsWith('…')).toBe(true);
    expect(t).toContain('😀'); // kept whole, not a broken half-character
    expect(t).not.toContain('�');
  });

  it('omits text when empty', () => {
    document.body.innerHTML = `<div id="d" data-comp="D"></div>`;
    expect(extractSemantics(el('d')).text).toBeUndefined();
  });
});

describe('extractSemantics — index/total', () => {
  it('reports 1-based index among same tag+comp siblings', () => {
    document.body.innerHTML = `<nav>${[0, 1, 2, 3, 4]
      .map((i) => `<button data-comp="NavItem">item${i}</button>`)
      .join('')}</nav>`;
    const second = document.querySelectorAll('nav > button')[1];
    const r = extractSemantics(second);
    expect(r.index).toBe(2);
    expect(r.total).toBe(5);
  });

  it('omits index/total when only one matching sibling', () => {
    document.body.innerHTML = `<nav><button id="b" data-comp="NavItem">solo</button></nav>`;
    const r = extractSemantics(el('b'));
    expect(r.index).toBeUndefined();
    expect(r.total).toBeUndefined();
  });

  it('does not count siblings with a different tag or data-comp', () => {
    document.body.innerHTML = `<nav><button id="b" data-comp="NavItem">a</button><button data-comp="Other">b</button><a data-comp="NavItem">c</a></nav>`;
    expect(extractSemantics(el('b')).index).toBeUndefined();
  });
});

describe('extractSemantics — path', () => {
  it('builds the component path root→leaf, dedups consecutive duplicates', () => {
    document.body.innerHTML = `<div data-comp="App"><div data-comp="Sidebar"><div data-comp="Sidebar"><button id="b" data-comp="NavItem">x</button></div></div></div>`;
    expect(extractSemantics(el('b')).path).toEqual(['App', 'Sidebar', 'NavItem']);
  });

  it('keeps only the 4 components closest to the leaf when deeper', () => {
    document.body.innerHTML = `<div data-comp="A"><div data-comp="B"><div data-comp="C"><div data-comp="D"><button id="b" data-comp="E">x</button></div></div></div></div>`;
    expect(extractSemantics(el('b')).path).toEqual(['B', 'C', 'D', 'E']);
  });

  it('omits path when no data-comp is present anywhere', () => {
    document.body.innerHTML = `<div><button id="b">x</button></div>`;
    expect(extractSemantics(el('b')).path).toBeUndefined();
  });
});

describe('extractSemantics — attrs', () => {
  it('picks only whitelisted attributes that are present', () => {
    document.body.innerHTML = `<a id="lnk" data-comp="L" data-testid="nav-rubrics" href="/rubrics" class="x" role="link">R</a>`;
    expect(extractSemantics(el('lnk')).attrs).toEqual({
      id: 'lnk',
      'data-testid': 'nav-rubrics',
      href: '/rubrics'
    });
  });

  it('omits attrs when no whitelisted attribute is present', () => {
    document.body.innerHTML = `<nav><span data-comp="S" class="only">t</span></nav>`;
    expect(extractSemantics(document.querySelector('.only') as Element).attrs).toBeUndefined();
  });
});

describe('extractSemantics — edges', () => {
  it('handles an element with no parent', () => {
    const orphan = document.createElement('button');
    orphan.setAttribute('data-comp', 'Orphan');
    orphan.textContent = 'hi';
    const r = extractSemantics(orphan);
    expect(r.index).toBeUndefined();
    expect(r.comp).toBe('Orphan');
  });

  it('returns tag-name comp and null loc for an unstamped element', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const r = extractSemantics(el('b'));
    expect(r.comp).toBe('button');
    expect(r.loc).toBeNull();
  });
});
