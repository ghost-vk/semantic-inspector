import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAnnotations } from './annotationStore';
import { driftCheck } from './driftCheck';
import type { AnnotationFile } from './types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'si-check-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeSrc = (rel: string, body: string): void => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), body, 'utf8');
};

const annoFile = (loc: string): AnnotationFile => ({
  version: 1,
  annotations: {
    btn: {
      name: 'btn',
      anchor: { comp: 'F', text: 'Save', attrs: { 'data-testid': 'save' } },
      lastSeen: { file: loc.split(':')[0], loc },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }
});

describe('driftCheck', () => {
  it('returns empty result when there are no annotations', () => {
    expect(driftCheck(dir)).toEqual({ entries: [], drifted: 0, ok: 0, skipped: 0 });
  });

  it('reports resolved when the element is at the recorded loc', () => {
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="save">Save</button>; }');
    const loc = 'src/F.tsx:1:23';
    writeAnnotations(dir, annoFile(loc));
    const r = driftCheck(dir);
    expect(r.entries[0].verdict).toBe('resolved');
    expect(r.ok).toBe(1);
  });

  it('reports missing when the element is gone', () => {
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="other">No</button>; }');
    writeAnnotations(dir, annoFile('src/F.tsx:1:23'));
    const r = driftCheck(dir);
    expect(r.entries[0].verdict).toBe('missing');
    expect(r.drifted).toBe(1);
  });

  it('skips an unparseable file with a warning, counts it, does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeSrc('src/Bad.tsx', 'function Bad( { return <div>;');
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="save">Save</button>; }');
    writeAnnotations(dir, annoFile('src/F.tsx:1:23'));
    const r = driftCheck(dir);
    expect(r.skipped).toBe(1);
    expect(r.entries[0].verdict).toBe('resolved'); // the parseable file still resolves
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a file over the parse byte cap and surfaces it in skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeSrc('src/Huge.tsx', `// ${'x'.repeat(2_100_000)}\n`);
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="save">Save</button>; }');
    writeAnnotations(dir, annoFile('src/F.tsx:1:23'));
    const r = driftCheck(dir);
    expect(r.skipped).toBe(1);
    expect(r.entries[0].verdict).toBe('resolved'); // the small file is still parsed + resolved
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('parse cap'));
    warn.mockRestore();
  });
});
