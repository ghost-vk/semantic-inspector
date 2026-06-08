import { afterEach, describe, expect, it } from 'vitest';
import { extractSemantics } from './extractSemantics';
import { ATTR_WHITELIST, cappedPath, normalizeText, PATH_CAP, pushPathSegment, TEXT_CAP } from './semanticShape';
import { staticAnchors } from './staticAnchors';
import type { StaticElement } from './types';

afterEach(() => {
  document.body.innerHTML = '';
});

// The contract this module exists to guard: an element captured at runtime (extractSemantics) and
// the same element recovered statically (staticAnchors) must normalize text and pick attributes
// identically — otherwise a previously-annotated element silently fails to re-resolve. These tests
// drive the SAME logical input through both extractors and assert the shared-shape fields agree.

const astText = (body: string): string | undefined =>
  staticAnchors('src/F.tsx', `function F() { return <p data-testid="t">${body}</p>; }`).find(
    (e: StaticElement) => e.attrs['data-testid'] === 't'
  )?.text;

const domText = (body: string): string | undefined => {
  document.body.innerHTML = `<p data-comp="F" data-testid="t">${body}</p>`;
  return extractSemantics(document.querySelector('p') as Element).text;
};

describe('semanticShape — primitives', () => {
  it('normalizeText collapses whitespace and trims', () => {
    expect(normalizeText('  Save\n  changes ')).toBe('Save changes');
  });

  it('normalizeText returns undefined for blank input', () => {
    expect(normalizeText('   \n\t ')).toBeUndefined();
  });

  it('normalizeText caps at TEXT_CAP code points with an ellipsis', () => {
    const out = normalizeText('a'.repeat(TEXT_CAP + 40)) as string;
    expect([...out]).toHaveLength(TEXT_CAP + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('normalizeText caps on a code-point boundary (never splits a surrogate pair)', () => {
    const out = normalizeText('x'.repeat(TEXT_CAP - 1) + '😀'.repeat(5)) as string;
    expect([...out]).toHaveLength(TEXT_CAP + 1);
    expect(out).toContain('😀');
    expect(out).not.toContain('�');
  });

  it('cappedPath keeps the PATH_CAP closest to the leaf, presented root→leaf', () => {
    const leafToRoot = ['E', 'D', 'C', 'B', 'A'];
    expect(cappedPath(leafToRoot)).toEqual(['B', 'C', 'D', 'E']);
    expect(cappedPath(leafToRoot)).toHaveLength(PATH_CAP);
  });

  it('pushPathSegment collapses consecutive duplicates and skips falsy', () => {
    const chain: string[] = [];
    pushPathSegment(chain, 'A');
    pushPathSegment(chain, 'A');
    pushPathSegment(chain, null);
    pushPathSegment(chain, undefined);
    pushPathSegment(chain, 'B');
    expect(chain).toEqual(['A', 'B']);
  });
});

describe('semanticShape — cross-extractor text parity', () => {
  for (const body of ['  Save\n  changes ', 'a'.repeat(200), 'x'.repeat(159) + '😀'.repeat(5), '   ']) {
    it(`extractSemantics and staticAnchors normalize "${body.slice(0, 12)}…" identically`, () => {
      expect(domText(body)).toEqual(astText(body));
    });
  }
});

describe('semanticShape — cross-extractor attr parity', () => {
  it('both extractors keep exactly the whitelisted attrs and drop the rest', () => {
    document.body.innerHTML =
      '<a data-comp="L" id="lnk" data-testid="nav" href="/r" type="button" class="x" role="link">R</a>';
    const dom = extractSemantics(document.querySelector('a') as Element).attrs;

    const ast = staticAnchors(
      'src/L.tsx',
      'function L() { return <a id="lnk" data-testid="nav" href="/r" type="button" className="x" role="link">R</a>; }'
    )[0].attrs;

    expect(dom).toEqual(ast);
    expect(dom).toEqual({ id: 'lnk', 'data-testid': 'nav', href: '/r', type: 'button' });
    // Every kept key is whitelisted.
    for (const k of Object.keys(ast)) expect(ATTR_WHITELIST as readonly string[]).toContain(k);
  });
});

describe('semanticShape — cross-extractor comp/path parity (single component)', () => {
  it('agree on comp and the collapsed component path', () => {
    document.body.innerHTML = '<div data-comp="NavItem"><button data-comp="NavItem" data-testid="b">x</button></div>';
    const dom = extractSemantics(document.querySelector('button') as Element);

    const ast = staticAnchors(
      'src/NavItem.tsx',
      'function NavItem() { return <div><button data-testid="b">x</button></div>; }'
    ).find((e) => e.attrs['data-testid'] === 'b') as StaticElement;

    expect(dom.comp).toBe(ast.comp);
    expect(dom.path ?? []).toEqual(ast.path);
    expect(ast.path).toEqual(['NavItem']);
  });
});
