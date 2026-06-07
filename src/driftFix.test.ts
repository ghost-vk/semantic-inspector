import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAnnotations, writeAnnotations } from './annotationStore';
import { driftFix } from './driftFix';
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
  entries: [
    { name: 'btn', verdict: 'moved', lastSeenLoc: 'src/F.tsx:1:1', resolvedLoc: 'src/F.tsx:9:3', candidates: [] }
  ]
};

describe('driftFix', () => {
  it('relocks a moved entry, bumps updatedAt, preserves createdAt + anchor', () => {
    writeAnnotations(dir, seed());
    const n = driftFix(dir, movedResult, '2026-02-02T00:00:00.000Z');
    expect(n).toBe(1);
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
    expect(n).toBe(0);
    expect(readAnnotations(dir).annotations.btn.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
