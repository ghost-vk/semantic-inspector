import { describe, expect, it } from 'vitest';
import { buildElementIndex, resolveAnchor, resolveAnchorIndexed } from './resolveAnchor';
import type { AnnotationAnchor, AnnotationLastSeen, StaticElement } from './types';

const el = (over: Partial<StaticElement> = {}): StaticElement => ({
  file: 'src/Sidebar.tsx',
  loc: 'src/Sidebar.tsx:10:5',
  comp: 'NavItem',
  path: ['App', 'Sidebar', 'NavItem'],
  text: 'Рубрики',
  attrs: { 'data-testid': 'nav-rubrics', href: '/rubrics' },
  ...over
});

const anchor = (over: Partial<AnnotationAnchor> = {}): AnnotationAnchor => ({
  comp: 'NavItem',
  path: ['App', 'Sidebar', 'NavItem'],
  text: 'Рубрики',
  attrs: { 'data-testid': 'nav-rubrics', href: '/rubrics' },
  ...over
});

const seen = (loc: string | null): AnnotationLastSeen => ({ file: loc ? loc.split(':')[0] : null, loc });

describe('resolveAnchor', () => {
  it('resolved: unique testid match at the same loc', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [el()]);
    expect(r.verdict).toBe('resolved');
    expect(r.resolvedLoc).toBe('src/Sidebar.tsx:10:5');
  });

  it('moved: unique match at a different loc', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [el({ loc: 'src/Sidebar.tsx:42:5' })]);
    expect(r.verdict).toBe('moved');
    expect(r.resolvedLoc).toBe('src/Sidebar.tsx:42:5');
  });

  it('missing: no candidate meets the identity threshold', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [
      el({ attrs: { 'data-testid': 'other' }, text: 'Other', comp: 'Else' })
    ]);
    expect(r.verdict).toBe('missing');
    expect(r.resolvedLoc).toBeNull();
  });

  it('ambiguous: two candidates tied at the top score', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [
      el({ loc: 'a.tsx:1:1' }),
      el({ loc: 'b.tsx:2:2' })
    ]);
    expect(r.verdict).toBe('ambiguous');
    expect(r.candidates).toHaveLength(2);
  });

  it('unverifiable: anchor has no strong attr and no text', () => {
    const a = anchor({ attrs: {}, text: undefined });
    const r = resolveAnchor('x', a, seen(null), [el()]);
    expect(r.verdict).toBe('unverifiable');
  });

  it('threshold: comp-only match is rejected (not enough identity)', () => {
    const a = anchor({ attrs: {}, text: undefined, comp: 'NavItem' });
    const r = resolveAnchor('x', a, seen(null), [el({ attrs: {}, text: undefined })]);
    expect(r.verdict).toBe('unverifiable');
  });

  it('comp + text clears the threshold when no strong attr exists', () => {
    const a = anchor({ attrs: {} });
    const r = resolveAnchor('x', a, seen('src/Sidebar.tsx:10:5'), [el({ attrs: {} })]);
    expect(r.verdict).toBe('resolved');
  });

  it('scoring: testid match outranks a text-only candidate', () => {
    const a = anchor();
    const r = resolveAnchor('x', a, seen('src/Sidebar.tsx:10:5'), [
      el({ loc: 'strong.tsx:1:1' }),
      el({ loc: 'weak.tsx:2:2', attrs: {}, comp: 'NavItem' })
    ]);
    expect(r.verdict).toBe('moved');
    expect(r.resolvedLoc).toBe('strong.tsx:1:1');
  });

  it('null lastSeen.loc with a unique match resolves (loc to be filled by --fix)', () => {
    const r = resolveAnchor('x', anchor(), seen(null), [el({ loc: 'src/New.tsx:3:3' })]);
    expect(r.verdict).toBe('resolved');
    expect(r.lastSeenLoc).toBeNull();
    expect(r.resolvedLoc).toBe('src/New.tsx:3:3');
  });
});

describe('resolveAnchorIndexed parity', () => {
  // The index narrows the candidate set; the verdict MUST be identical to the full-array scan.
  const cases: { label: string; anchor: AnnotationAnchor; loc: string | null; els: StaticElement[] }[] = [
    { label: 'resolved', anchor: anchor(), loc: 'src/Sidebar.tsx:10:5', els: [el()] },
    { label: 'moved', anchor: anchor(), loc: 'src/Sidebar.tsx:10:5', els: [el({ loc: 'src/Sidebar.tsx:42:5' })] },
    {
      label: 'missing',
      anchor: anchor(),
      loc: 'src/Sidebar.tsx:10:5',
      els: [el({ attrs: { 'data-testid': 'other' }, text: 'Other', comp: 'Else' })]
    },
    { label: 'ambiguous', anchor: anchor(), loc: 'x', els: [el({ loc: 'a.tsx:1:1' }), el({ loc: 'b.tsx:2:2' })] },
    { label: 'unverifiable', anchor: anchor({ attrs: {}, text: undefined }), loc: null, els: [el()] },
    { label: 'comp+text only', anchor: anchor({ attrs: {} }), loc: 'src/Sidebar.tsx:10:5', els: [el({ attrs: {} })] }
  ];

  for (const c of cases) {
    it(`matches the array path for "${c.label}"`, () => {
      const direct = resolveAnchor('p', c.anchor, seen(c.loc), c.els);
      const indexed = resolveAnchorIndexed('p', c.anchor, seen(c.loc), buildElementIndex(c.els));
      expect(indexed).toEqual(direct);
    });
  }

  it('finds a candidate buried among many non-matching elements (index returns it)', () => {
    const noise = Array.from({ length: 500 }, (_, i) =>
      el({ loc: `noise/${i}.tsx:1:1`, attrs: { 'data-testid': `n${i}` }, comp: `C${i}`, text: `t${i}` })
    );
    const target = el({ loc: 'src/Hit.tsx:7:7' });
    const index = buildElementIndex([...noise, target]);
    const r = resolveAnchorIndexed('p', anchor(), seen('src/Sidebar.tsx:10:5'), index);
    expect(r.verdict).toBe('moved');
    expect(r.resolvedLoc).toBe('src/Hit.tsx:7:7');
  });
});
