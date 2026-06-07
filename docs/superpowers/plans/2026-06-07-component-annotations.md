# Component Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user name an inspected element (+ tags/note) from a dedicated annotate mode and persist it to a repo file (JSON source of truth + Markdown mirror) via a dev-server endpoint, anchored on a durable descriptor so the name survives refactors.

**Architecture:** Browser side (runtime entry) computes the annotation payload with the existing `extractSemantics` and POSTs it; it never touches the filesystem. Node side (the `/vite` plugin entry) owns all filesystem access through a `configureServer` middleware. The output path is built only from `rootDir`, never from the request.

**Tech Stack:** TypeScript, React 18/19, Vite plugin (`configureServer`), Vitest + happy-dom, `@testing-library/react`, Biome, tsup, Changesets.

**Spec:** `docs/superpowers/specs/2026-06-07-component-annotations-design.md`

**Module boundaries (critical):** `annotationStore.ts` and `annotationMiddleware.ts` use `node:fs`/`node:path`/`node:http` and must be imported **only** by `src/vite.ts` (the node entry). The browser entry (`src/index.ts` → `SemanticInspector`/`useInspector`) must never transitively import them, or `node:fs` would leak into the consumer bundle. Browser-side new modules (`buildAnnotation`, `annotationClient`, `AnnotationEditor`) and the shared `annotationEndpoint` have no node imports.

---

## File Structure

| File | Action | Side |
| --- | --- | --- |
| `src/types.ts` | modify — add `Annotation*` types, `InspectMode`, `AnnotationDraft`, new props | — |
| `src/annotationEndpoint.ts` | create — shared `ANNOTATION_ENDPOINT` constant | shared |
| `src/annotationStore.ts` | create — read/upsert/renderMarkdown/write JSON+MD | node |
| `src/annotationMiddleware.ts` | create — validation (`parseInput`) + connect handler | node |
| `src/vite.ts` | modify — mount middleware via `configureServer` | node |
| `src/buildAnnotation.ts` | create — `Element` → `AnnotationInput` (reuses `extractSemantics`) | browser |
| `src/annotationClient.ts` | create — `saveAnnotation` fetch POST | browser |
| `src/AnnotationEditor.tsx` | create — inline name/tags/note form | browser |
| `src/useInspector.ts` | modify — mode `'off'\|'inspect'\|'annotate'`, annotate hotkey, draft | browser |
| `src/SemanticInspector.tsx` | modify — forward props, render editor, wire save | browser |
| `src/Overlay.tsx` | modify — mode-aware badge text | browser |
| `src/index.ts` | modify — re-export new public types | — |
| `README.md` | modify — annotate-mode docs + caveat | — |
| `.changeset/component-annotations.md` | create — `minor` changeset | — |

Each task ends green (`npx vitest run <file>` passing) and is committed before the next.

---

## Task 1: Public types + endpoint constant

**Files:**
- Modify: `src/types.ts`
- Create: `src/annotationEndpoint.ts`
- Modify: `src/index.ts`

This task is type-only plus a constant; it is verified by `typecheck`, not a unit test (types and `index.ts` are excluded from coverage, and `annotationEndpoint.ts` is exercised by later tasks' tests).

- [ ] **Step 1: Add the annotation types to `src/types.ts`** (append after the existing `SemanticInfo` interface, before `InspectTarget`):

```ts
/** Durable signals describing an annotated element, used to re-find it after refactors. */
export interface AnnotationAnchor {
  comp: string;
  path?: string[];
  text?: string;
  index?: number;
  total?: number;
  attrs?: Record<string, string>;
}

/** A non-authoritative pointer to where the element was last seen. May be stale. */
export interface AnnotationLastSeen {
  /** Relative file path (no line/col), or null when unstamped. */
  file: string | null;
  /** "<path>:<line>:<col>" snapshot, or null when unstamped. Hint only — verify before trusting. */
  loc: string | null;
}

/** One named annotation as persisted on disk. */
export interface Annotation {
  name: string;
  tags?: string[];
  note?: string;
  anchor: AnnotationAnchor;
  lastSeen: AnnotationLastSeen;
  createdAt: string;
  updatedAt: string;
}

/** On-disk shape of annotations.json. */
export interface AnnotationFile {
  version: 1;
  annotations: Record<string, Annotation>;
}

/** Payload the browser POSTs; the server adds timestamps and persists. */
export interface AnnotationInput {
  name: string;
  tags?: string[];
  note?: string;
  anchor: AnnotationAnchor;
  lastSeen: AnnotationLastSeen;
}

/** Inspector mode. Inspect and annotate are mutually exclusive. */
export type InspectMode = 'off' | 'inspect' | 'annotate';

/** Set when the user clicked an element in annotate mode (the editor is open). */
export interface AnnotationDraft {
  target: InspectTarget;
}
```

- [ ] **Step 2: Add new props to `SemanticInspectorProps`** (inside the existing interface, after `onError`). Note `Annotation` is referenced, so it must be declared above (Step 1 places the types before `InspectTarget`, which is before `SemanticInspectorProps` — keep that order):

```ts
  /** Enable annotate mode. Default false — no annotate hotkey, no editor, no network. */
  annotate?: boolean;
  /** Hotkey that toggles annotate mode. Default 'Alt+Shift+A'. */
  annotateHotkey?: string;
  /** Override the POST endpoint path. Default '/__semantic_inspector/annotations'. */
  annotateEndpoint?: string;
  /** Called after a successful annotation save. */
  onAnnotate?: (annotation: Annotation) => void;
```

- [ ] **Step 3: Replace `UseInspectorResult`** in `src/types.ts`:

```ts
/** Return value of `useInspector`. */
export interface UseInspectorResult {
  /** Back-compat: true whenever a mode is active (`mode !== 'off'`). */
  active: boolean;
  mode: InspectMode;
  target: InspectTarget | null;
  /** Non-null while the annotation editor is open. */
  draft: AnnotationDraft | null;
  /** Close the editor. */
  closeDraft: () => void;
}
```

- [ ] **Step 4: Create `src/annotationEndpoint.ts`:**

```ts
/** Default dev-server path the annotation editor POSTs to (shared by the browser client and the node middleware). */
export const ANNOTATION_ENDPOINT = '/__semantic_inspector/annotations';
```

- [ ] **Step 5: Re-export new public types from `src/index.ts`** (merge into the existing `export type { ... }` block, keeping it alphabetized):

```ts
export { SemanticInspector } from './SemanticInspector';
export type {
  Annotation,
  AnnotationAnchor,
  AnnotationDraft,
  AnnotationFile,
  AnnotationInput,
  AnnotationLastSeen,
  CopyKind,
  InspectMode,
  InspectTarget,
  LocInfo,
  SemanticInfo,
  SemanticInspectorProps,
  UseInspectorResult
} from './types';
export { useInspector } from './useInspector';
```

- [ ] **Step 6: Verify typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/types.ts src/index.ts src/annotationEndpoint.ts`
Expected: no errors. (`useInspector` still returns the old shape at this point — that's fixed in Task 8. If `tsc` reports `useInspector.ts`/`SemanticInspector.tsx` not matching `UseInspectorResult`, that's expected and resolved in Tasks 8–9; you may proceed — but prefer to land Task 1 green by also doing the minimal `useInspector` return shim in Step 7.)

- [ ] **Step 7: Minimal shim so the tree typechecks now.** In `src/useInspector.ts`, temporarily change the final `return { active, target };` to:

```ts
  return { active, mode: active ? 'inspect' : 'off', target, draft: null, closeDraft: () => {} };
```

(Task 8 replaces the whole hook; this shim only keeps Task 1 green.) Re-run Step 6 — expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/index.ts src/annotationEndpoint.ts src/useInspector.ts
git commit -m "feat(types): add annotation types, mode, and endpoint constant"
```

---

## Task 2: annotationStore (node — read / upsert / markdown / write)

**Files:**
- Create: `src/annotationStore.ts`
- Test: `src/annotationStore.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/annotationStore.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  annotationPaths,
  readAnnotations,
  renderMarkdown,
  upsert,
  writeAnnotations
} from './annotationStore';
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/annotationStore.test.ts`
Expected: FAIL — `annotationStore` module not found.

- [ ] **Step 3: Implement `src/annotationStore.ts`:**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Annotation, AnnotationFile, AnnotationInput } from './types';

const DIR = '.semantic-inspector';

/** Absolute paths for the annotation files, derived only from rootDir. */
export function annotationPaths(rootDir: string): { dir: string; json: string; md: string } {
  const dir = resolve(rootDir, DIR);
  return { dir, json: join(dir, 'annotations.json'), md: join(dir, 'annotations.md') };
}

/** Read annotations.json, or an empty file if it does not exist. Throws on malformed JSON. */
export function readAnnotations(rootDir: string): AnnotationFile {
  const { json } = annotationPaths(rootDir);
  if (!existsSync(json)) return { version: 1, annotations: {} };
  return JSON.parse(readFileSync(json, 'utf8')) as AnnotationFile;
}

/** Insert or replace an annotation by name. createdAt is preserved across updates; now is injected. */
export function upsert(file: AnnotationFile, input: AnnotationInput, now: string): AnnotationFile {
  const prev = file.annotations[input.name];
  const next: Annotation = {
    name: input.name,
    tags: input.tags,
    note: input.note,
    anchor: input.anchor,
    lastSeen: input.lastSeen,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now
  };
  return { version: 1, annotations: { ...file.annotations, [input.name]: next } };
}

/** Render the human/Graphify-readable Markdown mirror. Pure. */
export function renderMarkdown(file: AnnotationFile): string {
  const lines: string[] = [
    '# Semantic annotations',
    '',
    '> Generated by semantic-inspector. Source of truth: annotations.json. Do not edit by hand.',
    ''
  ];
  for (const name of Object.keys(file.annotations).sort()) {
    const a = file.annotations[name];
    lines.push(`## ${name}`, '');
    if (a.tags?.length) lines.push(`- **tags:** ${a.tags.join(', ')}`);
    const pathStr = a.anchor.path?.length ? ` (${a.anchor.path.join(' › ')})` : '';
    lines.push(`- **component:** ${a.anchor.comp}${pathStr}`);
    if (a.anchor.text) lines.push(`- **text:** "${a.anchor.text}"`);
    if (a.anchor.index != null && a.anchor.total != null) {
      lines.push(`- **index:** ${a.anchor.index}/${a.anchor.total}`);
    }
    if (a.anchor.attrs) {
      for (const [k, v] of Object.entries(a.anchor.attrs)) {
        lines.push(`- **${k === 'data-testid' ? 'testid' : k}:** ${v}`);
      }
    }
    if (a.lastSeen.loc) lines.push(`- **last seen:** ${a.lastSeen.loc} _(hint — may be stale, verify)_`);
    if (a.note) lines.push(`- **note:** ${a.note}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Write annotations.json (source of truth) then regenerate the Markdown mirror (best-effort). */
export function writeAnnotations(rootDir: string, file: AnnotationFile): void {
  const { dir, json, md } = annotationPaths(rootDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(json, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  try {
    writeFileSync(md, renderMarkdown(file), 'utf8');
  } catch {
    // Mirror is derived/best-effort; annotations.json is the source of truth and already written.
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/annotationStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/annotationStore.ts src/annotationStore.test.ts
git commit -m "feat(annotations): add annotationStore (json source + md mirror)"
```

---

## Task 3: annotationMiddleware (node — validation + handler)

**Files:**
- Create: `src/annotationMiddleware.ts`
- Test: `src/annotationMiddleware.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/annotationMiddleware.test.ts`:

```ts
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
    // The malicious name is only a JSON key; the file path is built from rootDir alone.
    const stored = JSON.parse(readFileSync(annotationPaths(dir).json, 'utf8'));
    expect(stored.annotations['../../etc/passwd']).toBeTruthy();
    expect(res._status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/annotationMiddleware.test.ts`
Expected: FAIL — `annotationMiddleware` not found.

- [ ] **Step 3: Implement `src/annotationMiddleware.ts`:**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ANNOTATION_ENDPOINT } from './annotationEndpoint';
import { readAnnotations, upsert, writeAnnotations } from './annotationStore';
import type { AnnotationAnchor, AnnotationInput, AnnotationLastSeen } from './types';

type Next = () => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

const NAME_CAP = 200;
const NOTE_CAP = 2000;
const TAG_CAP = 60;
const TAGS_MAX = 30;
const TEXT_CAP = 200;
const PATH_MAX = 8;
const BODY_CAP = 256 * 1024;
const ATTR_KEYS = ['id', 'data-testid', 'name', 'href', 'type'];

const isStr = (v: unknown): v is string => typeof v === 'string';

function parseAnchor(v: unknown): AnnotationAnchor | null {
  if (typeof v !== 'object' || v === null) return null;
  const a = v as Record<string, unknown>;
  if (!isStr(a.comp) || a.comp.length > TEXT_CAP) return null;
  const out: AnnotationAnchor = { comp: a.comp };
  if (a.path !== undefined) {
    if (!Array.isArray(a.path) || a.path.length > PATH_MAX) return null;
    if (!a.path.every((p) => isStr(p) && p.length <= TEXT_CAP)) return null;
    out.path = a.path as string[];
  }
  if (a.text !== undefined) {
    if (!isStr(a.text) || a.text.length > TEXT_CAP) return null;
    out.text = a.text;
  }
  if (a.index !== undefined) {
    if (typeof a.index !== 'number') return null;
    out.index = a.index;
  }
  if (a.total !== undefined) {
    if (typeof a.total !== 'number') return null;
    out.total = a.total;
  }
  if (a.attrs !== undefined) {
    if (typeof a.attrs !== 'object' || a.attrs === null) return null;
    const attrs: Record<string, string> = {};
    for (const [k, val] of Object.entries(a.attrs as Record<string, unknown>)) {
      if (!ATTR_KEYS.includes(k)) continue; // drop anything not whitelisted
      if (!isStr(val) || val.length > TEXT_CAP) return null;
      attrs[k] = val;
    }
    out.attrs = attrs;
  }
  return out;
}

function parseLastSeen(v: unknown): AnnotationLastSeen | null {
  if (typeof v !== 'object' || v === null) return null;
  const l = v as Record<string, unknown>;
  const file = l.file === null ? null : isStr(l.file) && l.file.length <= TEXT_CAP ? l.file : undefined;
  const loc = l.loc === null ? null : isStr(l.loc) && l.loc.length <= TEXT_CAP ? l.loc : undefined;
  if (file === undefined || loc === undefined) return null;
  return { file, loc };
}

/** Validate an untrusted request body into an AnnotationInput, or null if invalid. */
export function parseInput(body: unknown): AnnotationInput | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isStr(b.name) || b.name.trim() === '' || b.name.length > NAME_CAP) return null;
  let tags: string[] | undefined;
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > TAGS_MAX) return null;
    if (!b.tags.every((t) => isStr(t) && t.length <= TAG_CAP)) return null;
    tags = b.tags as string[];
  }
  let note: string | undefined;
  if (b.note !== undefined) {
    if (!isStr(b.note) || b.note.length > NOTE_CAP) return null;
    note = b.note;
  }
  const anchor = parseAnchor(b.anchor);
  if (!anchor) return null;
  const lastSeen = parseLastSeen(b.lastSeen);
  if (!lastSeen) return null;
  return { name: b.name.trim(), tags, note, anchor, lastSeen };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > BODY_CAP) throw new Error('body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export interface MiddlewareOptions {
  endpoint?: string;
  /** Injectable clock for tests. */
  now?: () => string;
}

/**
 * Connect-style middleware that persists annotations on POST. The output path is derived ONLY from
 * `rootDir` (never from the request body or URL), so a malicious `name` cannot escape the directory.
 * Mounted via `configureServer`, so it exists only on the dev server.
 */
export function createAnnotationMiddleware(rootDir: string, options: MiddlewareOptions = {}): Handler {
  const endpoint = options.endpoint ?? ANNOTATION_ENDPOINT;
  const now = options.now ?? (() => new Date().toISOString());
  return (req, res, next) => {
    if ((req.url ?? '').split('?')[0] !== endpoint || req.method !== 'POST') {
      next();
      return;
    }
    readBody(req)
      .then((raw) => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          send(res, 400, { error: 'invalid JSON' });
          return;
        }
        const input = parseInput(body);
        if (!input) {
          send(res, 400, { error: 'invalid annotation' });
          return;
        }
        try {
          const updated = upsert(readAnnotations(rootDir), input, now());
          writeAnnotations(rootDir, updated);
          send(res, 200, updated.annotations[input.name]);
        } catch {
          send(res, 500, { error: 'failed to persist annotation' });
        }
      })
      .catch(() => send(res, 400, { error: 'bad request body' }));
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/annotationMiddleware.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/annotationMiddleware.ts src/annotationMiddleware.test.ts
git commit -m "feat(annotations): add validating dev-server middleware"
```

---

## Task 4: Mount middleware via configureServer

**Files:**
- Modify: `src/vite.ts`
- Test: `src/vite.test.ts` (add one case)

- [ ] **Step 1: Add the failing test** — append to `src/vite.test.ts`, inside the existing `describe('stampLocVite', ...)` block:

```ts
  it('mounts an annotations middleware on the dev server', () => {
    const plugin = stampLocVite();
    const used: unknown[] = [];
    const server = { middlewares: { use: (fn: unknown) => used.push(fn) } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal ViteDevServer double
    (plugin.configureServer as (s: any) => void)(server as any);
    expect(used).toHaveLength(1);
    expect(typeof used[0]).toBe('function');
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/vite.test.ts`
Expected: FAIL — `plugin.configureServer` is undefined.

- [ ] **Step 3: Implement** — in `src/vite.ts`, add the import at the top:

```ts
import { createAnnotationMiddleware } from './annotationMiddleware';
```

Then, inside `stampLocVite`, before the `return {`, add:

```ts
  const rootDir = opts.rootDir ?? process.cwd();
```

And add a `configureServer` hook to the returned plugin object (place it right after `apply: 'serve',`):

```ts
    configureServer(server) {
      server.middlewares.use(createAnnotationMiddleware(rootDir));
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/vite.test.ts`
Expected: PASS (all cases, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/vite.ts src/vite.test.ts
git commit -m "feat(vite): mount annotation middleware via configureServer"
```

---

## Task 5: buildAnnotation (browser — Element → AnnotationInput)

**Files:**
- Create: `src/buildAnnotation.ts`
- Test: `src/buildAnnotation.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/buildAnnotation.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { buildAnnotation } from './buildAnnotation';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('buildAnnotation', () => {
  it('builds an input from a stamped element, reusing extractSemantics', () => {
    document.body.innerHTML = `<nav data-comp="Sidebar"><button id="b" data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:99:9">x</button></nav>`;
    const el = document.getElementById('b') as Element;
    const out = buildAnnotation(el, '  пилюля  ', ['nav'], '  note ');
    expect(out.name).toBe('пилюля');
    expect(out.tags).toEqual(['nav']);
    expect(out.note).toBe('note');
    expect(out.anchor.comp).toBe('NavItem');
    expect(out.anchor.text).toBe('Рубрики');
    expect(out.anchor.attrs).toMatchObject({ 'data-testid': 'nav-rubrics' });
    expect(out.lastSeen).toEqual({ file: 'src/Sidebar.tsx', loc: 'src/Sidebar.tsx:93:15' });
  });

  it('drops empty tags/note and nulls lastSeen for an unstamped element', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const out = buildAnnotation(document.getElementById('b') as Element, 'x', [], '');
    expect(out.tags).toBeUndefined();
    expect(out.note).toBeUndefined();
    expect(out.lastSeen).toEqual({ file: null, loc: null });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/buildAnnotation.test.ts`
Expected: FAIL — `buildAnnotation` not found.

- [ ] **Step 3: Implement `src/buildAnnotation.ts`:**

```ts
import { extractSemantics } from './extractSemantics';
import type { AnnotationInput } from './types';

/**
 * Build the POST payload for an annotated element. The anchor is the existing semantic descriptor
 * (so resolution reuses the same signals); `lastSeen` is the data-loc snapshot, used only as a hint.
 * Pure — no DOM mutation, no network.
 */
export function buildAnnotation(el: Element, name: string, tags: string[], note: string): AnnotationInput {
  const sem = extractSemantics(el);
  const trimmedNote = note.trim();
  return {
    name: name.trim(),
    tags: tags.length ? tags : undefined,
    note: trimmedNote ? trimmedNote : undefined,
    anchor: {
      comp: sem.comp,
      path: sem.path,
      text: sem.text,
      index: sem.index,
      total: sem.total,
      attrs: sem.attrs
    },
    lastSeen: { file: sem.loc ? sem.loc.split(':')[0] : null, loc: sem.loc }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/buildAnnotation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/buildAnnotation.ts src/buildAnnotation.test.ts
git commit -m "feat(annotations): add buildAnnotation (element to payload)"
```

---

## Task 6: annotationClient (browser — fetch POST)

**Files:**
- Create: `src/annotationClient.ts`
- Test: `src/annotationClient.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/annotationClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAnnotation } from './annotationClient';
import type { AnnotationInput } from './types';

const input: AnnotationInput = {
  name: 'пилюля',
  anchor: { comp: 'NavItem' },
  lastSeen: { file: null, loc: null }
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saveAnnotation', () => {
  it('POSTs JSON and returns the saved annotation on 200', async () => {
    const saved = { ...input, createdAt: 'x', updatedAt: 'x' };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => saved }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await saveAnnotation('/ep', input);

    expect(out).toEqual(saved);
    expect(fetchMock).toHaveBeenCalledWith('/ep', expect.objectContaining({ method: 'POST' }));
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.name).toBe('пилюля');
  });

  it('rejects on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );
    await expect(saveAnnotation('/ep', input)).rejects.toThrow('500');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/annotationClient.test.ts`
Expected: FAIL — `annotationClient` not found.

- [ ] **Step 3: Implement `src/annotationClient.ts`:**

```ts
import type { Annotation, AnnotationInput } from './types';

/** POST an annotation to the dev-server endpoint. Resolves with the saved record, rejects on failure. */
export async function saveAnnotation(endpoint: string, input: AnnotationInput): Promise<Annotation> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`annotation save failed: ${res.status}`);
  return (await res.json()) as Annotation;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/annotationClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/annotationClient.ts src/annotationClient.test.ts
git commit -m "feat(annotations): add annotationClient fetch wrapper"
```

---

## Task 7: AnnotationEditor (browser — inline form)

**Files:**
- Create: `src/AnnotationEditor.tsx`
- Test: `src/AnnotationEditor.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/AnnotationEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotationEditor } from './AnnotationEditor';
import type { InspectTarget } from './types';

function target(): InspectTarget {
  const el = document.createElement('div');
  return {
    comp: 'NavItem',
    loc: 'src/Sidebar.tsx:93:15',
    el,
    // biome-ignore lint/suspicious/noExplicitAny: partial DOMRect is enough for positioning
    rect: { left: 10, top: 10, bottom: 30, right: 50, width: 40, height: 20 } as any
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AnnotationEditor', () => {
  it('submits trimmed name and parsed tags on Save', () => {
    const onSubmit = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('annotation name'), { target: { value: ' пилюля ' } });
    fireEvent.change(screen.getByLabelText('annotation tags'), { target: { value: 'nav, cta ,' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith('пилюля', ['nav', 'cta'], '');
  });

  it('submits on Enter', () => {
    const onSubmit = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const name = screen.getByLabelText('annotation name');
    fireEvent.change(name, { target: { value: 'pill' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('pill', [], '');
  });

  it('does not submit an empty name', () => {
    const onSubmit = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cancels on Esc', () => {
    const onCancel = vi.fn();
    render(<AnnotationEditor target={target()} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText('annotation name'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows an error message when provided', () => {
    render(<AnnotationEditor target={target()} onSubmit={vi.fn()} onCancel={vi.fn()} error="save failed" />);
    expect(screen.getByText('save failed')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/AnnotationEditor.test.tsx`
Expected: FAIL — `AnnotationEditor` not found.

- [ ] **Step 3: Implement `src/AnnotationEditor.tsx`:**

```tsx
import { type CSSProperties, type JSX, type KeyboardEvent, useState } from 'react';
import type { InspectTarget } from './types';

// Above the overlay highlight/tip, below the toast band (see Overlay.tsx Z layering).
const Z = 2147483640;

interface AnnotationEditorProps {
  target: InspectTarget;
  error?: string | null;
  onSubmit: (name: string, tags: string[], note: string) => void;
  onCancel: () => void;
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function panelStyle(r: DOMRect): CSSProperties {
  const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 180));
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 280));
  return {
    position: 'fixed',
    top,
    left,
    zIndex: Z,
    width: 260,
    padding: 10,
    borderRadius: 8,
    background: 'rgba(17,17,17,0.97)',
    color: '#fff',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  };
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #444',
  background: '#222',
  color: '#fff',
  font: 'inherit'
};

export function AnnotationEditor({ target, error, onSubmit, onCancel }: AnnotationEditorProps): JSX.Element {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');

  const submit = (): void => {
    if (!name.trim()) return;
    onSubmit(name.trim(), parseTags(tags), note);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // Stop propagation so the inspector's window-level Esc/hotkey handlers don't also fire.
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dev-tool overlay form, key handling is scoped here
    <div style={panelStyle(target.rect)} onKeyDown={onKeyDown}>
      <div style={{ opacity: 0.7 }}>annotate · {target.comp}</div>
      <input
        // biome-ignore lint/a11y/noAutofocus: inline dev-tool editor, immediate focus is the intended UX
        autoFocus
        aria-label="annotation name"
        placeholder="name (e.g. пилюля)"
        style={inputStyle}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="annotation tags"
        placeholder="tags, comma separated"
        style={inputStyle}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <input
        aria-label="annotation note"
        placeholder="note (optional)"
        style={inputStyle}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" style={{ font: 'inherit' }} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" style={{ font: 'inherit' }} onClick={submit}>
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/AnnotationEditor.test.tsx`
Expected: PASS (5 tests). If Biome flags the `biome-ignore` comments as unused/misformatted, run `npx biome check --write src/AnnotationEditor.tsx` and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/AnnotationEditor.tsx src/AnnotationEditor.test.tsx
git commit -m "feat(annotations): add inline AnnotationEditor form"
```

---

## Task 8: Annotate mode in useInspector

**Files:**
- Modify: `src/useInspector.ts` (replace the whole file)
- Test: `src/useInspector.test.tsx` (add an annotate describe block)

- [ ] **Step 1: Write the failing tests** — append to `src/useInspector.test.tsx` (the helpers `press`, `navTree`, and `vi.mock('./clipboard', ...)` already exist at the top of that file; reuse them):

```tsx
const ANNOTATE: KeyboardEventInit = { key: 'a', code: 'KeyA', altKey: true, shiftKey: true };

describe('useInspector — annotate mode', () => {
  it('annotate hotkey toggles annotate mode only when annotate is enabled', () => {
    const off = renderHook(() => useInspector({ annotate: false }));
    act(() => press(ANNOTATE));
    expect(off.result.current.mode).toBe('off');

    const on = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    expect(on.result.current.mode).toBe('annotate');
    expect(on.result.current.active).toBe(true);
  });

  it('clicking in annotate mode opens a draft and does not copy', async () => {
    const el = navTree();
    const { result } = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(result.current.draft?.target.el).toBe(el);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('closeDraft clears the draft', async () => {
    const el = navTree();
    const { result } = renderHook(() => useInspector({ annotate: true }));
    act(() => press(ANNOTATE));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    act(() => result.current.closeDraft());
    expect(result.current.draft).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/useInspector.test.tsx`
Expected: FAIL — `mode`/`draft`/`closeDraft` not behaving (current shim returns a fixed shape).

- [ ] **Step 3: Replace `src/useInspector.ts` with the full implementation:**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copyElementShot, copyText } from './clipboard';
import { extractSemantics } from './extractSemantics';
import { resolveTarget } from './resolveTarget';
import type {
  AnnotationDraft,
  CopyKind,
  InspectMode,
  InspectTarget,
  LocInfo,
  SemanticInfo,
  SemanticInspectorProps,
  UseInspectorResult
} from './types';

const DEFAULT_HOTKEY = 'Alt+Shift+S';
const DEFAULT_ANNOTATE_HOTKEY = 'Alt+Shift+A';

function defaultFormat(t: LocInfo): string {
  return t.loc ? `${t.comp} — ${t.loc}` : t.comp;
}

// data-testid reads better as "testid"; other whitelisted attrs use their own name.
function attrLabel(name: string): string {
  return name === 'data-testid' ? 'testid' : name;
}

function semanticFormat(t: SemanticInfo): string {
  const lines = [t.loc ? `${t.comp} — ${t.loc}` : t.comp];
  if (t.text) lines.push(`text: "${t.text}"`);
  if (t.index != null && t.total != null) lines.push(`index: ${t.index}/${t.total}`);
  if (t.path?.length) lines.push(`path: ${t.path.join(' › ')}`);
  if (t.attrs) {
    for (const [k, v] of Object.entries(t.attrs)) lines.push(`${attrLabel(k)}: ${v}`);
  }
  return lines.join('\n');
}

interface Hotkey {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  key: string;
}

/** Parse 'Alt+Shift+S' into a descriptor. The final token is the key (empty → literal '+'). */
function parseHotkey(hotkey: string): Hotkey {
  const parts = hotkey.split('+').map((p) => p.trim().toLowerCase());
  const has = (...names: string[]): boolean => names.some((n) => parts.includes(n));
  const last = parts[parts.length - 1];
  return {
    alt: has('alt'),
    shift: has('shift'),
    ctrl: has('ctrl', 'control'),
    meta: has('meta', 'cmd'),
    key: last === '' ? '+' : last
  };
}

// Physical-key codes whose token differs from the produced character, so a hotkey written with
// the unshifted glyph still matches when Shift transforms it (e.g. Ctrl+Shift+/ → e.key '?').
const CODE_TO_KEY: Record<string, string> = {
  slash: '/',
  backslash: '\\',
  period: '.',
  comma: ',',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equal: '='
};

/** Whether a keydown event matches the parsed hotkey. */
function matchHotkey(e: KeyboardEvent, hk: Hotkey): boolean {
  if (e.altKey !== hk.alt || e.shiftKey !== hk.shift || e.ctrlKey !== hk.ctrl || e.metaKey !== hk.meta) {
    return false;
  }
  const rawCode = e.code.toLowerCase();
  const code = CODE_TO_KEY[rawCode] ?? rawCode.replace(/^(key|digit)/, '');
  return e.key.toLowerCase() === hk.key || code === hk.key;
}

function sameTarget(a: InspectTarget | null, b: InspectTarget | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.el === b.el &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

/**
 * Inspection + annotation state and listeners.
 * - keydown: the inspect hotkey toggles inspect mode; the annotate hotkey (when enabled) toggles
 *   annotate mode; Esc exits. Inspect and annotate are mutually exclusive.
 * - while a mode is active and no editor is open: mousemove (rAF-coalesced) updates `target`.
 * - click (capture, preventDefault): in inspect mode copies text / Shift+click a screenshot; in
 *   annotate mode opens an editor draft (no copy). While the editor is open, listeners are
 *   suspended so the highlight freezes and editor clicks are not intercepted.
 */
export function useInspector(opts: SemanticInspectorProps = {}): UseInspectorResult {
  const { hotkey = DEFAULT_HOTKEY, annotate = false, annotateHotkey = DEFAULT_ANNOTATE_HOTKEY } = opts;
  const [mode, setMode] = useState<InspectMode>('off');
  const [target, setTarget] = useState<InspectTarget | null>(null);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);

  // Fresh callbacks without re-subscribing listeners.
  const cbRef = useRef<SemanticInspectorProps>(opts);
  cbRef.current = opts;

  // Latest hovered target, so the click handler acts on exactly what is highlighted.
  const targetRef = useRef<InspectTarget | null>(null);

  const hk = useMemo(() => parseHotkey(hotkey), [hotkey]);
  const ahk = useMemo(() => parseHotkey(annotateHotkey), [annotateHotkey]);

  const closeDraft = useCallback(() => setDraft(null), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (matchHotkey(e, hk)) {
        e.preventDefault();
        setMode((m) => (m === 'inspect' ? 'off' : 'inspect'));
      } else if (annotate && matchHotkey(e, ahk)) {
        e.preventDefault();
        setMode((m) => (m === 'annotate' ? 'off' : 'annotate'));
      } else if (e.key === 'Escape') {
        setMode((m) => (m === 'off' ? m : 'off'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hk, ahk, annotate]);

  useEffect(() => {
    if (mode === 'off') {
      targetRef.current = null;
      setTarget(null);
      setDraft(null);
      return;
    }
    if (draft) return; // editor open: freeze the highlight and suspend listeners

    let rafId = 0;
    let lastX = 0;
    let lastY = 0;
    let shotInFlight = false;

    function onMove(e: MouseEvent): void {
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafId) return; // one update per frame, regardless of input rate
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const next = resolveTarget(document.elementFromPoint(lastX, lastY));
        targetRef.current = next;
        setTarget((prev) => (sameTarget(prev, next) ? prev : next));
      });
    }

    function onClick(e: MouseEvent): void {
      const t = targetRef.current ?? resolveTarget(document.elementFromPoint(e.clientX, e.clientY));
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();

      if (mode === 'annotate') {
        setDraft({ target: t });
        return;
      }

      const { formatText, onCopy, onError, semantic = false } = cbRef.current;
      const done = (kind: CopyKind, payload: string): void => onCopy?.(kind, payload);
      const fail = (kind: CopyKind, err: unknown): void => {
        if (onError) onError(kind, err);
        // Surface failures even without an onError handler (console is the right channel for a dev tool).
        else console.warn(`[semantic-inspector] ${kind} copy failed:`, err);
      };

      if (e.shiftKey) {
        if (shotInFlight) return; // ignore overlapping captures
        shotInFlight = true;
        copyElementShot(t.el)
          .then(
            () => done('screenshot', t.comp),
            (err: unknown) => fail('screenshot', err)
          )
          .finally(() => {
            shotInFlight = false;
          });
      } else {
        const info: SemanticInfo = semantic ? extractSemantics(t.el) : { comp: t.comp, loc: t.loc };
        const fmt: (i: SemanticInfo) => string = formatText ?? (semantic ? semanticFormat : defaultFormat);
        const text = fmt(info);
        copyText(text).then(
          () => done('text', text),
          (err: unknown) => fail('text', err)
        );
      }
    }

    window.addEventListener('mousemove', onMove, { capture: true, passive: true });
    window.addEventListener('click', onClick, true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      if (rafId) cancelAnimationFrame(rafId);
      document.body.style.cursor = prevCursor;
    };
  }, [mode, draft]);

  return { active: mode !== 'off', mode, target, draft, closeDraft };
}
```

- [ ] **Step 4: Run the full hook test file (annotate + existing regression)**

Run: `npx vitest run src/useInspector.test.tsx`
Expected: PASS — the new annotate block plus all existing hotkey/click/semantic tests (the inspect-mode behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/useInspector.ts src/useInspector.test.tsx
git commit -m "feat(inspector): add annotate mode (hotkey + click draft)"
```

---

## Task 9: Wire SemanticInspector + Overlay + render the editor

**Files:**
- Modify: `src/Overlay.tsx`
- Modify: `src/SemanticInspector.tsx` (replace the whole file)
- Test: `src/SemanticInspector.test.tsx` (add an annotate describe block)

- [ ] **Step 1: Update `src/Overlay.tsx` for mode-aware badge text.** Add `InspectMode` to the type import and a `mode` prop, and switch the badge label. Change the import line to:

```ts
import type { InspectMode, InspectTarget } from './types';
```

Change `OverlayProps`:

```ts
interface OverlayProps {
  target: InspectTarget | null;
  toast: string | null;
  mode?: InspectMode;
}
```

Change the component signature + badge line:

```tsx
export const Overlay: MemoExoticComponent<(props: OverlayProps) => JSX.Element> = memo(function Overlay({
  target,
  toast,
  mode
}: OverlayProps): JSX.Element {
  const badgeText =
    mode === 'annotate'
      ? '✏️ annotate · click=name · Esc=exit'
      : '⌖ inspect · click=copy · ⇧click=shot · Esc=exit';
  return (
    <>
      <div style={badge}>{badgeText}</div>
      {target && (
```

(The rest of `Overlay.tsx` is unchanged. `Overlay.tsx` is excluded from coverage, so no test is required for it.)

- [ ] **Step 2: Write the failing tests** — append to `src/SemanticInspector.test.tsx`. Put the `vi.mock('./annotationClient', ...)` at module top with any other mocks (hoisted by Vitest):

```tsx
vi.mock('./annotationClient', () => ({ saveAnnotation: vi.fn() }));
```

Then add (importing `saveAnnotation`, `act`, `fireEvent`, `render`, `screen` as needed — match the file's existing imports, adding what's missing):

```tsx
import { saveAnnotation } from './annotationClient';

const ANNOTATE_KEY: KeyboardEventInit = { key: 'a', code: 'KeyA', altKey: true, shiftKey: true };

function annotatable(): HTMLElement {
  document.body.innerHTML = `<button id="t" data-comp="NavItem" data-loc="src/S.tsx:1:1" data-testid="nav">Рубрики</button>`;
  return document.getElementById('t') as HTMLElement;
}

describe('SemanticInspector — annotate', () => {
  it('opens the editor on click in annotate mode and saves', async () => {
    vi.mocked(saveAnnotation).mockResolvedValue({
      name: 'пилюля',
      anchor: { comp: 'NavItem' },
      lastSeen: { file: null, loc: null },
      createdAt: 't',
      updatedAt: 't'
    });
    const el = annotatable();
    const onAnnotate = vi.fn();
    render(<SemanticInspector annotate onAnnotate={onAnnotate} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ANNOTATE_KEY));
    });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });

    fireEvent.change(screen.getByLabelText('annotation name'), { target: { value: 'пилюля' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(saveAnnotation).toHaveBeenCalledOnce();
    expect(onAnnotate).toHaveBeenCalledWith(expect.objectContaining({ name: 'пилюля' }));
  });

  it('does not wire the annotate hotkey when annotate is not set', () => {
    render(<SemanticInspector />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ANNOTATE_KEY));
    });
    expect(screen.queryByLabelText('annotation name')).toBeNull();
  });
});
```

If `src/SemanticInspector.test.tsx` doesn't already import `act`/`fireEvent`/`render`/`screen` from `@testing-library/react` and `describe/it/expect/vi` from `vitest`, add them. Keep `afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; })` (add if absent).

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run src/SemanticInspector.test.tsx`
Expected: FAIL — `SemanticInspector` doesn't render the editor / accept `annotate`.

- [ ] **Step 4: Replace `src/SemanticInspector.tsx`:**

```tsx
import { type JSX, useEffect, useState } from 'react';
import { AnnotationEditor } from './AnnotationEditor';
import { saveAnnotation } from './annotationClient';
import { ANNOTATION_ENDPOINT } from './annotationEndpoint';
import { buildAnnotation } from './buildAnnotation';
import { Overlay } from './Overlay';
import type { Annotation, CopyKind, SemanticInspectorProps } from './types';
import { useInspector } from './useInspector';

// How long the copy/save toast stays visible (ms).
const TOAST_MS = 1400;

/**
 * Semantic inspector. Renders nothing until toggled by a hotkey. Gating (where to mount) is the
 * consumer's responsibility: mount it under your dev flag, ideally via React.lazy, so it is not
 * pulled into the production bundle.
 */
export function SemanticInspector(props: SemanticInspectorProps): JSX.Element | null {
  const [toast, setToast] = useState<string | null>(null);
  const [annoError, setAnnoError] = useState<string | null>(null);

  // Auto-hide the toast; cleanup cancels the pending timer (including on unmount).
  useEffect(() => {
    if (toast == null) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const { active, mode, target, draft, closeDraft } = useInspector({
    hotkey: props.hotkey,
    semantic: props.semantic,
    formatText: props.formatText,
    annotate: props.annotate,
    annotateHotkey: props.annotateHotkey,
    onCopy: (kind: CopyKind, payload: string) => {
      setToast(kind === 'text' ? `✓ ${payload}` : '✓ screenshot copied');
      props.onCopy?.(kind, payload);
    },
    onError: (kind: CopyKind, err: unknown) => {
      setToast(`✗ ${kind} failed`);
      props.onError?.(kind, err);
    }
  });

  const endpoint = props.annotateEndpoint ?? ANNOTATION_ENDPOINT;

  const submitAnnotation = (name: string, tags: string[], note: string): void => {
    if (!draft) return;
    const input = buildAnnotation(draft.target.el, name, tags, note);
    saveAnnotation(endpoint, input).then(
      (saved: Annotation) => {
        setToast(`✓ ${saved.name}`);
        setAnnoError(null);
        props.onAnnotate?.(saved);
        closeDraft();
      },
      (err: unknown) => {
        // Annotate has its own failure channel (not the copy-oriented onError): keep the editor open.
        setAnnoError('save failed');
        console.warn('[semantic-inspector] annotation save failed:', err);
      }
    );
  };

  const cancelAnnotation = (): void => {
    setAnnoError(null);
    closeDraft();
  };

  if (!active && !toast) return null;
  return (
    <>
      <Overlay target={active ? target : null} toast={toast} mode={mode} />
      {draft && (
        <AnnotationEditor
          target={draft.target}
          error={annoError}
          onSubmit={submitAnnotation}
          onCancel={cancelAnnotation}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/SemanticInspector.test.tsx`
Expected: PASS — annotate block + existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/Overlay.tsx src/SemanticInspector.tsx src/SemanticInspector.test.tsx
git commit -m "feat(inspector): render annotation editor and wire save"
```

---

## Task 10: Changeset, README, full verification gate

**Files:**
- Create: `.changeset/component-annotations.md`
- Modify: `README.md`

- [ ] **Step 1: Create the changeset** — `.changeset/component-annotations.md`:

```markdown
---
"semantic-inspector": minor
---

Add an opt-in `annotate` mode. A dedicated hotkey (default `Alt+Shift+A`) enters annotate mode; in
it, clicking an element opens an inline editor to give the element a human name (+ optional tags and
a note). The annotation is POSTed to a dev-server endpoint added by the Vite plugin and persisted to
`.semantic-inspector/annotations.json` (source of truth) with a regenerated `annotations.md` mirror.

Annotations are anchored on a durable descriptor (the same signals as the semantic payload:
component, visible text, sibling index, component path, and stable attributes like `data-testid`),
not on `file:line:col`, so a name keeps resolving after refactors. The endpoint exists only on the
dev server, and its output path is derived solely from `rootDir` (never from the request). New
props: `annotate`, `annotateHotkey`, `annotateEndpoint`, `onAnnotate`. Default behavior is unchanged.
```

- [ ] **Step 2: Add a README section** — insert after the `## Semantic payload (opt-in)` section, before `## Three entry points`:

````markdown
## Annotate mode (opt-in)

Beyond copying a pointer, you can give an element a durable, human-friendly name so you and an AI
share the same vocabulary later — without re-inspecting. Enable it and press the annotate hotkey
(default `Alt+Shift+A`) to enter annotate mode; click an element to open an inline editor for a
**name** (+ optional **tags** and a **note**):

```tsx
<SemanticInspector annotate onAnnotate={(a) => toast(`saved ${a.name}`)} />
```

Saving POSTs to a dev-server endpoint that the Vite plugin adds (`configureServer`, dev only) and
writes two files at your project root:

- `.semantic-inspector/annotations.json` — source of truth (upserted by name).
- `.semantic-inspector/annotations.md` — a regenerated, human/Graphify-readable mirror.

Each annotation is anchored on a **durable descriptor** — the same signals as the semantic payload
(component, visible text, sibling index, component path, and stable attributes such as
`data-testid`) — not on `file:line:col`. The line/file is kept only as a `lastSeen` hint. So when an
AI later needs "the пилюля," it reads the file and re-finds the element by grepping the stable
signals (testid → id → visible text + component), which survive refactors far better than a line
number.

Commit `.semantic-inspector/` to share the vocabulary with your team and your AI.

> **Note:** annotations store the element's visible text, your note, and stable attributes
> (including `href`) in a repo file. Avoid annotating elements whose text/URL contains secrets or
> PII, and review `.semantic-inspector/annotations.json` before committing.

### How an AI resolves a name

Given a name (e.g. "пилюля"): read `.semantic-inspector/annotations.json`, find the entry, then grep
the live code in decreasing order of stability — `data-testid` → `id`/`name`/`href` → visible
`text` near the `data-comp`. Treat `lastSeen.loc` as a first guess only; verify it.
````

- [ ] **Step 3: Add `annotate` rows to the API props table** — in the `### \`<SemanticInspector>\` props` table, add after the `semantic` row:

```markdown
| `annotate`   | `false`                  | enable annotate mode: a hotkey opens an inline editor to name an element; the annotation is persisted to `.semantic-inspector/` via the dev plugin (see [Annotate mode](#annotate-mode-opt-in)) |
| `annotateHotkey` | `'Alt+Shift+A'`      | hotkey that toggles annotate mode |
| `annotateEndpoint` | `'/__semantic_inspector/annotations'` | override the POST endpoint path |
| `onAnnotate` | —                        | called with the saved annotation after a successful save |
```

- [ ] **Step 4: Run the full verification gate**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: Biome clean; `tsc` no errors; all test files pass (existing + the new `annotationStore`, `annotationMiddleware`, `buildAnnotation`, `annotationClient`, `AnnotationEditor`, plus the augmented `vite`, `useInspector`, `SemanticInspector`); tsup build succeeds with `index`/`vite`/`babel` entries.

- [ ] **Step 5: Confirm coverage thresholds hold**

Run: `npm run test:cov`
Expected: lines/functions/statements ≥ 80, branches ≥ 70. If `AnnotationEditor.tsx` or `annotationMiddleware.ts` dips below branch threshold, add the missing case (e.g. a `parseInput` rejection for an out-of-cap field, or the editor's "empty name" guard) — do not lower thresholds.

- [ ] **Step 6: Confirm no node built-ins leaked into the browser entry**

Run: `node -e "const s=require('fs').readFileSync('dist/index.js','utf8'); if (/node:fs|node:path|node:http|annotationStore|annotationMiddleware/.test(s)) { console.error('LEAK: node-only code in browser entry'); process.exit(1) } else console.log('ok: browser entry clean')"`
Expected: `ok: browser entry clean`. (If it reports a leak, something in the `index` import graph pulled in a node-only module — check that `SemanticInspector`/`useInspector` import only `buildAnnotation`/`annotationClient`/`AnnotationEditor`/`annotationEndpoint`.)

- [ ] **Step 7: Commit**

```bash
git add .changeset/component-annotations.md README.md
git commit -m "docs: document annotate mode + changeset"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** data model (Task 1), persistence JSON+MD (Task 2), endpoint+security+validation (Tasks 3–4), descriptor anchor via `extractSemantics` (Task 5), client (Task 6), capture UI (Task 7), annotate mode/gesture (Task 8), wiring+forwarding (Task 9), resolution convention + Graphify mirror + PII caveat + changeset (Tasks 2/10). All spec sections map to a task.
- **Placeholder scan:** none — every code/test step has full content.
- **Type consistency:** `AnnotationInput`/`Annotation`/`AnnotationAnchor`/`AnnotationLastSeen`/`AnnotationFile` (Task 1) are used identically across store/middleware/client/buildAnnotation; `createAnnotationMiddleware(rootDir, { now })`, `saveAnnotation(endpoint, input)`, `buildAnnotation(el, name, tags, note)`, and `ANNOTATION_ENDPOINT` names match every call site; `UseInspectorResult` (mode/draft/closeDraft) matches the hook return and the `SemanticInspector` destructure.
- **Module boundary:** node-only modules imported only by `vite.ts`; Step 6 of Task 10 asserts the browser entry stays clean.
