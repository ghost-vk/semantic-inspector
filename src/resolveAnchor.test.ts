import { describe, expect, it } from 'vitest';
import { resolveAnchor } from './resolveAnchor';
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
