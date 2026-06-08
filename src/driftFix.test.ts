import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAnnotations, writeAnnotations } from './annotationStore';
import { applyFix, driftFix } from './driftFix';
import type { AnnotationFile, DriftResult } from './types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'si-fix-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const seed = (): AnnotationFile => ({
  version: 1,
  annotations: {
    btn: {
      name: 'btn',
      anchor: { comp: 'F', attrs: { 'data-testid': 'save' } },
      lastSeen: { file: 'src/F.tsx', loc: 'src/F.tsx:1:1' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }
});

const movedResult: DriftResult = {
  drifted: 1,
  ok: 0,
  skipped: 0,
  entries: [
    { name: 'btn', verdict: 'moved', lastSeenLoc: 'src/F.tsx:1:1', resolvedLoc: 'src/F.tsx:9:3', candidates: [] }
  ]
};

describe('driftFix', () => {
  it('relocks a moved entry, bumps updatedAt, preserves createdAt + anchor', () => {
    writeAnnotations(dir, seed());
    const n = driftFix(dir, movedResult, '2026-02-02T00:00:00.000Z');
    expect(n).toEqual(['btn']);
    const a = readAnnotations(dir).annotations.btn;
    expect(a.lastSeen.loc).toBe('src/F.tsx:9:3');
    expect(a.lastSeen.file).toBe('src/F.tsx');
    expect(a.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(a.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(a.anchor.attrs?.['data-testid']).toBe('save');
  });

  it('does not touch missing/ambiguous/resolved-in-place entries', () => {
    writeAnnotations(dir, seed());
    const n = driftFix(
      dir,
      {
        drifted: 1,
        ok: 1,
        skipped: 0,
        entries: [
          {
            name: 'btn',
            verdict: 'resolved',
            lastSeenLoc: 'src/F.tsx:1:1',
            resolvedLoc: 'src/F.tsx:1:1',
            candidates: []
          }
        ]
      },
      '2026-02-02T00:00:00.000Z'
    );
    expect(n).toEqual([]);
    expect(readAnnotations(dir).annotations.btn.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('applyFix', () => {
  it('flips relocked entries to resolved and recomputes counts, in memory', () => {
    const next = applyFix(movedResult, ['btn']);
    expect(next.entries[0].verdict).toBe('resolved');
    expect(next.entries[0].lastSeenLoc).toBe('src/F.tsx:9:3'); // now equals the resolved loc
    expect(next.drifted).toBe(0);
    expect(next.ok).toBe(1);
  });

  it('returns the input unchanged when nothing was fixed', () => {
    expect(applyFix(movedResult, [])).toBe(movedResult);
  });

  it('only touches the named entries', () => {
    const result: DriftResult = {
      drifted: 2,
      ok: 0,
      skipped: 0,
      entries: [
        { name: 'a', verdict: 'moved', lastSeenLoc: 'f.tsx:1:1', resolvedLoc: 'f.tsx:5:1', candidates: [] },
        { name: 'b', verdict: 'missing', lastSeenLoc: 'g.tsx:1:1', resolvedLoc: null, candidates: [] }
      ]
    };
    const next = applyFix(result, ['a']);
    expect(next.entries[0].verdict).toBe('resolved');
    expect(next.entries[1].verdict).toBe('missing'); // untouched
    expect(next.drifted).toBe(1);
    expect(next.ok).toBe(1);
  });
});
