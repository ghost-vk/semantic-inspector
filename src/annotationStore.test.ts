import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { annotationPaths, readAnnotations, renderMarkdown, upsert, writeAnnotations } from './annotationStore';
import type { AnnotationInput } from './types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'si-anno-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const input = (over: Partial<AnnotationInput> = {}): AnnotationInput => ({
  name: 'пилюля',
  tags: ['nav'],
  note: 'main',
  anchor: {
    comp: 'NavItem',
    path: ['App', 'Sidebar', 'NavItem'],
    text: 'Рубрики',
    index: 2,
    total: 5,
    attrs: { 'data-testid': 'nav-rubrics', href: '/rubrics' }
  },
  lastSeen: { file: 'src/Sidebar.tsx', loc: 'src/Sidebar.tsx:93:15' },
  ...over
});

describe('annotationStore', () => {
  it('reads an empty file when none exists', () => {
    expect(readAnnotations(dir)).toEqual({ version: 1, annotations: {} });
  });

  it('upsert inserts by name and stamps timestamps', () => {
    const file = upsert({ version: 1, annotations: {} }, input(), '2026-01-01T00:00:00.000Z');
    const a = file.annotations['пилюля'];
    expect(a.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(a.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(a.anchor.comp).toBe('NavItem');
  });

  it('upsert preserves createdAt but bumps updatedAt on update', () => {
    const first = upsert({ version: 1, annotations: {} }, input(), '2026-01-01T00:00:00.000Z');
    const second = upsert(first, input({ note: 'changed' }), '2026-02-02T00:00:00.000Z');
    const a = second.annotations['пилюля'];
    expect(a.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(a.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(a.note).toBe('changed');
  });

  it('writes JSON + MD and reads JSON back', () => {
    const file = upsert({ version: 1, annotations: {} }, input(), '2026-01-01T00:00:00.000Z');
    writeAnnotations(dir, file);
    expect(readAnnotations(dir)).toEqual(file);
    const md = readFileSync(annotationPaths(dir).md, 'utf8');
    expect(md).toContain('## пилюля');
    expect(md).toContain('**testid:** nav-rubrics');
    expect(md).toContain('_(hint — may be stale, verify)_');
  });

  it('renderMarkdown omits absent fields', () => {
    const file = upsert(
      { version: 1, annotations: {} },
      input({ tags: undefined, note: undefined, anchor: { comp: 'Bare' }, lastSeen: { file: null, loc: null } }),
      '2026-01-01T00:00:00.000Z'
    );
    const md = renderMarkdown(file);
    expect(md).toContain('**component:** Bare');
    expect(md).not.toContain('**tags:**');
    expect(md).not.toContain('last seen');
  });

  it('throws on malformed JSON (never silently overwrites)', () => {
    const { dir: d, json } = annotationPaths(dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(json, '{ not json', 'utf8');
    expect(() => readAnnotations(dir)).toThrow();
  });
});
