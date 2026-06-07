import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOTATION_ENDPOINT } from './annotationEndpoint';
import { createAnnotationMiddleware, parseInput } from './annotationMiddleware';
import { annotationPaths } from './annotationStore';
import type { AnnotationInput } from './types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'si-mw-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validInput = (over: Partial<AnnotationInput> = {}): AnnotationInput => ({
  name: 'пилюля',
  tags: ['nav'],
  anchor: { comp: 'NavItem', attrs: { 'data-testid': 'nav-rubrics' } },
  lastSeen: { file: 'src/Sidebar.tsx', loc: 'src/Sidebar.tsx:93:15' },
  ...over
});

// biome-ignore lint/suspicious/noExplicitAny: lightweight req/res doubles for a connect handler
function mockReq(method: string, url: string, body?: unknown): any {
  const r = Readable.from([body === undefined ? '' : JSON.stringify(body)]) as any;
  r.method = method;
  r.url = url;
  return r;
}

function mockRes(): ServerResponse & { _status: number; _body: string } {
  // biome-ignore lint/suspicious/noExplicitAny: minimal ServerResponse double
  const res: any = {
    statusCode: 200,
    _status: 200,
    _body: '',
    setHeader() {},
    end(chunk?: string) {
      this._status = this.statusCode;
      this._body = chunk ?? '';
    }
  };
  return res;
}

async function run(req: unknown, res: unknown, rootDir = dir): Promise<{ next: ReturnType<typeof vi.fn> }> {
  const next = vi.fn();
  // biome-ignore lint/suspicious/noExplicitAny: doubles
  createAnnotationMiddleware(rootDir, { now: () => '2026-01-01T00:00:00.000Z' })(req as any, res as any, next);
  await new Promise((r) => setTimeout(r, 0));
  return { next };
}

describe('parseInput', () => {
  it('rejects a missing or empty name', () => {
    expect(parseInput({ ...validInput(), name: '' })).toBeNull();
    expect(parseInput({ anchor: { comp: 'X' }, lastSeen: { file: null, loc: null } })).toBeNull();
  });

  it('accepts a valid input and trims the name', () => {
    expect(parseInput({ ...validInput(), name: '  пилюля  ' })?.name).toBe('пилюля');
  });

  it('drops non-whitelisted attrs', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid attr key
    const out = parseInput(validInput({ anchor: { comp: 'X', attrs: { id: 'a', onclick: 'evil' } as any } }));
    expect(out?.anchor.attrs).toEqual({ id: 'a' });
  });

  it('rejects non-finite or non-integer index/total', () => {
    expect(parseInput(validInput({ anchor: { comp: 'X', index: Number.POSITIVE_INFINITY } }))).toBeNull();
    expect(parseInput(validInput({ anchor: { comp: 'X', index: 1.5 } }))).toBeNull();
    expect(parseInput(validInput({ anchor: { comp: 'X', total: Number.NaN } }))).toBeNull();
  });

  it('rejects prototype-polluting names', () => {
    expect(parseInput(validInput({ name: '__proto__' }))).toBeNull();
    expect(parseInput(validInput({ name: 'constructor' }))).toBeNull();
  });
});

describe('createAnnotationMiddleware', () => {
  it('persists a valid POST and responds 200 with the saved annotation', async () => {
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, validInput()), res);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body).name).toBe('пилюля');
    const stored = JSON.parse(readFileSync(annotationPaths(dir).json, 'utf8'));
    expect(stored.annotations['пилюля']).toBeTruthy();
  });

  it('responds 400 on an invalid body', async () => {
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, { name: '' }), res);
    expect(res._status).toBe(400);
  });

  it('falls through for non-POST methods and other paths', async () => {
    const r1 = await run(mockReq('GET', ANNOTATION_ENDPOINT), mockRes());
    expect(r1.next).toHaveBeenCalled();
    const r2 = await run(mockReq('POST', '/something-else'), mockRes());
    expect(r2.next).toHaveBeenCalled();
  });

  it('keeps the output path inside rootDir regardless of name (no traversal)', async () => {
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, validInput({ name: '../../etc/passwd' })), res);
    const stored = JSON.parse(readFileSync(annotationPaths(dir).json, 'utf8'));
    expect(stored.annotations['../../etc/passwd']).toBeTruthy();
    expect(res._status).toBe(200);
  });
});
