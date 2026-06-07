import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
function mockReq(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): any {
  const r = Readable.from([body === undefined ? '' : JSON.stringify(body)]) as any;
  r.method = method;
  r.url = url;
  // Default to the content type the real client sends; individual tests override to exercise the guard.
  r.headers = { 'content-type': 'application/json', ...headers };
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

  it('rejects a half-populated index/total pair', () => {
    expect(parseInput(validInput({ anchor: { comp: 'X', index: 1 } }))).toBeNull();
    expect(parseInput(validInput({ anchor: { comp: 'X', total: 3 } }))).toBeNull();
  });

  it('rejects index greater than total', () => {
    expect(parseInput(validInput({ anchor: { comp: 'X', index: 5, total: 2 } }))).toBeNull();
  });

  it('accepts a valid index/total pair', () => {
    expect(parseInput(validInput({ anchor: { comp: 'X', index: 2, total: 5 } }))?.anchor.index).toBe(2);
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

  it.each(['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])('falls through for %s on the endpoint', async (method) => {
    const r = await run(mockReq(method, ANNOTATION_ENDPOINT, validInput()), mockRes());
    expect(r.next).toHaveBeenCalled();
  });

  it('rejects a POST without an application/json content-type (415)', async () => {
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, validInput(), { 'content-type': 'text/plain' }), res);
    expect(res._status).toBe(415);
  });

  it('rejects a cross-origin POST where Origin does not match Host (403)', async () => {
    const res = mockRes();
    await run(
      mockReq('POST', ANNOTATION_ENDPOINT, validInput(), {
        origin: 'http://evil.example',
        host: 'localhost:5173'
      }),
      res
    );
    expect(res._status).toBe(403);
  });

  it('allows a same-origin POST where Origin matches Host', async () => {
    const res = mockRes();
    await run(
      mockReq('POST', ANNOTATION_ENDPOINT, validInput(), {
        origin: 'http://localhost:5173',
        host: 'localhost:5173'
      }),
      res
    );
    expect(res._status).toBe(200);
  });

  it('responds 500 when the write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Put a regular file where the .semantic-inspector directory must be created → mkdir/write fails.
    writeFileSync(annotationPaths(dir).dir, 'x', 'utf8');
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, validInput()), res);
    expect(res._status).toBe(500);
    expect(JSON.parse(res._body).error).toBe('failed to persist annotation');
    warn.mockRestore();
  });

  it('serializes concurrent POSTs without losing a write', async () => {
    const mw = createAnnotationMiddleware(dir, { now: () => '2026-01-01T00:00:00.000Z' });
    // biome-ignore lint/suspicious/noExplicitAny: req/res doubles
    mw(mockReq('POST', ANNOTATION_ENDPOINT, validInput({ name: 'a' })) as any, mockRes() as any, vi.fn());
    // biome-ignore lint/suspicious/noExplicitAny: req/res doubles
    mw(mockReq('POST', ANNOTATION_ENDPOINT, validInput({ name: 'b' })) as any, mockRes() as any, vi.fn());
    await new Promise((r) => setTimeout(r, 10));
    const stored = JSON.parse(readFileSync(annotationPaths(dir).json, 'utf8'));
    expect(Object.keys(stored.annotations).sort()).toEqual(['a', 'b']);
  });

  it('routes on a custom endpoint when configured', async () => {
    const res = mockRes();
    const next = vi.fn();
    createAnnotationMiddleware(dir, { endpoint: '/custom', now: () => '2026-01-01T00:00:00.000Z' })(
      // biome-ignore lint/suspicious/noExplicitAny: req/res doubles
      mockReq('POST', '/custom', validInput()) as any,
      // biome-ignore lint/suspicious/noExplicitAny: req/res doubles
      res as any,
      next
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(res._status).toBe(200);
  });

  it('rejects an oversized body', async () => {
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, validInput({ note: 'x'.repeat(300 * 1024) })), res);
    expect(res._status).toBe(400);
  });

  it('keeps the output path inside rootDir regardless of name (no traversal)', async () => {
    const res = mockRes();
    await run(mockReq('POST', ANNOTATION_ENDPOINT, validInput({ name: '../../etc/passwd' })), res);
    const stored = JSON.parse(readFileSync(annotationPaths(dir).json, 'utf8'));
    expect(stored.annotations['../../etc/passwd']).toBeTruthy();
    expect(res._status).toBe(200);
  });
});
