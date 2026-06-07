import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectSourceFiles } from './collectSourceFiles';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'si-walk-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, body = 'x'): void => {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
};

describe('collectSourceFiles', () => {
  it('finds source files and returns relative POSIX paths', () => {
    write('src/a.tsx');
    write('src/sub/b.ts');
    const files = collectSourceFiles(dir);
    expect(files).toContain('src/a.tsx');
    expect(files).toContain('src/sub/b.ts');
  });

  it('excludes node_modules, dist, dotdirs, tests and .d.ts', () => {
    write('src/a.tsx');
    write('node_modules/pkg/index.js');
    write('dist/out.js');
    write('.git/hooks/x.js');
    write('src/a.test.tsx');
    write('src/types.d.ts');
    const files = collectSourceFiles(dir);
    expect(files).toEqual(['src/a.tsx']);
  });

  it('restricts to include path prefixes when given', () => {
    write('src/keep.tsx');
    write('lib/skip.tsx');
    expect(collectSourceFiles(dir, ['src'])).toEqual(['src/keep.tsx']);
  });
});
