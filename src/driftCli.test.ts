import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAnnotations } from './annotationStore';
import { runCli } from './driftCli';
import type { AnnotationFile } from './types';

let dir: string;
let log: string[];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'si-cli-'));
  log = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((s) => void log.push(String(s)));
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

const writeSrc = (rel: string, body: string): void => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), body, 'utf8');
};
const anno = (loc: string): AnnotationFile => ({
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

describe('runCli', () => {
  it('exits 0 with no annotations', async () => {
    expect(await runCli(['check', '--root', dir])).toBe(0);
    expect(log.join('\n')).toContain('no annotations found');
  });

  it('exits 1 on drift (missing element)', async () => {
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="nope">No</button>; }');
    writeAnnotations(dir, anno('src/F.tsx:1:23'));
    expect(await runCli(['--root', dir])).toBe(1);
  });

  it('--json emits a valid report', async () => {
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="nope">No</button>; }');
    writeAnnotations(dir, anno('src/F.tsx:1:23'));
    await runCli(['--root', dir, '--json']);
    const parsed = JSON.parse(log.join('\n'));
    expect(parsed.entries[0].verdict).toBe('missing');
  });

  it('--fix relocks moved and then exits 0', async () => {
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="save">Save</button>; }');
    writeAnnotations(dir, anno('src/F.tsx:99:99'));
    expect(await runCli(['--root', dir, '--fix'], '2026-02-02T00:00:00.000Z')).toBe(0);
  });

  it('--allow-moved downgrades moved to exit 0', async () => {
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="save">Save</button>; }');
    writeAnnotations(dir, anno('src/F.tsx:99:99'));
    expect(await runCli(['--root', dir, '--allow-moved'])).toBe(0);
  });

  it('exits 2 on a bad flag', async () => {
    expect(await runCli(['--root', dir, '--nope'])).toBe(2);
  });

  it('exits 2 on an unknown command', async () => {
    expect(await runCli(['frobnicate', '--root', dir])).toBe(2);
  });

  it('exits 2 on malformed annotations.json', async () => {
    mkdirSync(join(dir, '.semantic-inspector'), { recursive: true });
    writeFileSync(join(dir, '.semantic-inspector', 'annotations.json'), '{ not json', 'utf8');
    expect(await runCli(['--root', dir])).toBe(2);
  });

  it('--help exits 0', async () => {
    expect(await runCli(['--help'])).toBe(0);
  });
});
