import { describe, expect, it } from 'vitest';
import { formatHuman, formatJson } from './driftReport';
import type { DriftResult } from './types';

const result: DriftResult = {
  drifted: 2,
  ok: 1,
  entries: [
    { name: 'ok1', verdict: 'resolved', lastSeenLoc: 'a.tsx:1:1', resolvedLoc: 'a.tsx:1:1', candidates: [] },
    {
      name: 'mv',
      verdict: 'moved',
      lastSeenLoc: 'b.tsx:1:1',
      resolvedLoc: 'b.tsx:9:1',
      candidates: [{ loc: 'b.tsx:9:1', score: 100 }]
    },
    { name: 'gone', verdict: 'missing', lastSeenLoc: 'c.tsx:1:1', resolvedLoc: null, candidates: [] },
    {
      name: 'amb',
      verdict: 'ambiguous',
      lastSeenLoc: 'd.tsx:1:1',
      resolvedLoc: null,
      candidates: [
        { loc: 'd.tsx:2:2', score: 50 },
        { loc: 'd.tsx:3:3', score: 50 }
      ]
    },
    { name: 'unk', verdict: 'unverifiable', lastSeenLoc: null, resolvedLoc: null, candidates: [] }
  ]
};

describe('driftReport', () => {
  it('formatHuman shows a row per entry and a fixable summary', () => {
    const out = formatHuman(result);
    expect(out).toContain('5 annotations, 2 drifted');
    expect(out).toContain('moved');
    expect(out).toContain('missing');
    expect(out).toContain('add data-testid');
    expect(out).toContain('fixable'); // the moved entry is fixable
  });

  it('formatHuman handles the empty case', () => {
    expect(formatHuman({ entries: [], drifted: 0, ok: 0 })).toContain('no annotations found');
  });

  it('formatJson emits valid, stable JSON', () => {
    const parsed = JSON.parse(formatJson(result));
    expect(parsed.drifted).toBe(2);
    expect(parsed.entries).toHaveLength(5);
    expect(parsed.entries[1].resolvedLoc).toBe('b.tsx:9:1');
  });
});
