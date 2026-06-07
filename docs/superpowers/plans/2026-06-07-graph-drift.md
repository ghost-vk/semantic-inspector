# Graph Drift Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `semantic-inspector` CLI that re-resolves each annotation in `annotations.json` against the current source tree (via Babel AST), reports drift, fails CI on drift, emits a `--json` report for an AI agent, and relocks safe `moved` entries with `--fix`.

**Architecture:** A node-only pipeline reached only through a `bin` (never the browser entry). `collectSourceFiles` → `staticAnchors` (AST analog of `extractSemantics`) builds the candidate set; `resolveAnchor` (pure) scores each annotation against it and assigns a verdict; `driftCheck` orchestrates; `driftReport` formats; `driftFix` relocks; `driftCli` wires args → exit code; `cli.ts` is the bin shim.

**Tech Stack:** TypeScript (ESM), `@babel/core` (parse-only, optional peer), `node:util` `parseArgs`, `node:fs`, Vitest + happy-dom, tsup, biome.

**Source of truth:** [`docs/superpowers/specs/2026-06-07-graph-drift-design.md`](../specs/2026-06-07-graph-drift-design.md).

---

## Shared Interfaces (defined in Task 1, used everywhere — keep names exact)

```ts
// src/types.ts (new exports)
interface StaticElement {
  file: string;                  // relative POSIX path
  loc: string;                   // "file:line:col" — identical to the stamp format
  comp: string | null;
  path: string[];                // ancestor component chain root→leaf, deduped, cap 4
  text?: string;                 // direct/descendant JSXText, collapsed, code-point-capped 160
  attrs: Record<string, string>; // literal whitelisted attrs in source
}
type DriftVerdict = 'resolved' | 'moved' | 'missing' | 'ambiguous' | 'unverifiable';
interface DriftEntry {
  name: string;
  verdict: DriftVerdict;
  lastSeenLoc: string | null;
  resolvedLoc: string | null;
  candidates: { loc: string; score: number }[];
}
interface DriftResult { entries: DriftEntry[]; drifted: number; ok: number; }
```

Function signatures (exact, referenced across tasks):

```ts
// src/stampLocBabel.ts (newly exported)
export function isHostElement(name: BabelTypes.JSXOpeningElement['name']): boolean;
export function nearestComponentName(path: NodePath): string | null;

// src/staticAnchors.ts
export function staticAnchors(file: string, source: string): StaticElement[];
// src/collectSourceFiles.ts
export function collectSourceFiles(root: string, include?: string[]): string[];
// src/resolveAnchor.ts
export function resolveAnchor(
  name: string,
  anchor: AnnotationAnchor,
  lastSeen: AnnotationLastSeen,
  elements: StaticElement[]
): DriftEntry;
// src/driftCheck.ts
export function driftCheck(root: string, opts?: { include?: string[] }): DriftResult;
// src/driftReport.ts
export function formatHuman(result: DriftResult): string;
export function formatJson(result: DriftResult): string;
// src/driftFix.ts
export function driftFix(root: string, result: DriftResult, now: string): number;
// src/driftCli.ts
export function runCli(argv: string[], now?: string): Promise<number>;
```

---

## Task 1: Types + reuse exports

**Files:**
- Modify: `src/types.ts` (append new types)
- Modify: `src/stampLocBabel.ts` (export two existing helpers)

- [ ] **Step 1: Add the drift types to `src/types.ts`**

Append at the end of `src/types.ts`:

```ts
/** A JSX host element recovered statically from source (AST analog of SemanticInfo). */
export interface StaticElement {
  /** Relative POSIX file path. */
  file: string;
  /** "<relpath>:<line>:<col>" — byte-identical to the data-loc stamp format. */
  loc: string;
  /** nearestComponentName, or null when no PascalCase component ancestor exists. */
  comp: string | null;
  /** Ancestor component-name chain, root→leaf, consecutive duplicates collapsed, max 4. */
  path: string[];
  /** Literal JSXText under the element, whitespace-collapsed, code-point-capped at 160. */
  text?: string;
  /** Whitelisted attributes with string-literal values: id, data-testid, name, href, type. */
  attrs: Record<string, string>;
}

/** Outcome of re-resolving one annotation against current source. */
export type DriftVerdict = 'resolved' | 'moved' | 'missing' | 'ambiguous' | 'unverifiable';

/** One annotation's drift result. */
export interface DriftEntry {
  name: string;
  verdict: DriftVerdict;
  /** lastSeen.loc from the annotation (may be null for an unstamped anchor). */
  lastSeenLoc: string | null;
  /** Where it resolves now: equal to lastSeenLoc when resolved, the new loc when moved, else null. */
  resolvedLoc: string | null;
  /** Ranked match candidates (score desc, loc asc). */
  candidates: { loc: string; score: number }[];
}

/** Aggregate drift result for the whole annotation set. */
export interface DriftResult {
  entries: DriftEntry[];
  /** Count of moved/missing/ambiguous entries (resolved + unverifiable excluded). */
  drifted: number;
  /** Count of resolved entries. */
  ok: number;
}
```

- [ ] **Step 2: Export the two helpers from `src/stampLocBabel.ts`**

In `src/stampLocBabel.ts`, add `export` to the two existing function declarations (do not change their bodies):

Change `function isHostElement(` → `export function isHostElement(`
Change `function nearestComponentName(` → `export function nearestComponentName(`

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no emit, no errors). New types are additive; the two exports are additive.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/stampLocBabel.ts
git commit -m "feat(drift): add drift types; export stamp helpers for reuse"
```

---

## Task 2: `resolveAnchor` — pure scoring + verdicts (the core)

**Files:**
- Create: `src/resolveAnchor.ts`
- Test: `src/resolveAnchor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resolveAnchor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveAnchor } from './resolveAnchor';
import type { AnnotationAnchor, AnnotationLastSeen, StaticElement } from './types';

const el = (over: Partial<StaticElement> = {}): StaticElement => ({
  file: 'src/Sidebar.tsx',
  loc: 'src/Sidebar.tsx:10:5',
  comp: 'NavItem',
  path: ['App', 'Sidebar', 'NavItem'],
  text: 'Рубрики',
  attrs: { 'data-testid': 'nav-rubrics', href: '/rubrics' },
  ...over
});

const anchor = (over: Partial<AnnotationAnchor> = {}): AnnotationAnchor => ({
  comp: 'NavItem',
  path: ['App', 'Sidebar', 'NavItem'],
  text: 'Рубрики',
  attrs: { 'data-testid': 'nav-rubrics', href: '/rubrics' },
  ...over
});

const seen = (loc: string | null): AnnotationLastSeen => ({ file: loc ? loc.split(':')[0] : null, loc });

describe('resolveAnchor', () => {
  it('resolved: unique testid match at the same loc', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [el()]);
    expect(r.verdict).toBe('resolved');
    expect(r.resolvedLoc).toBe('src/Sidebar.tsx:10:5');
  });

  it('moved: unique match at a different loc', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [el({ loc: 'src/Sidebar.tsx:42:5' })]);
    expect(r.verdict).toBe('moved');
    expect(r.resolvedLoc).toBe('src/Sidebar.tsx:42:5');
  });

  it('missing: no candidate meets the identity threshold', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [
      el({ attrs: { 'data-testid': 'other' }, text: 'Other', comp: 'Else' })
    ]);
    expect(r.verdict).toBe('missing');
    expect(r.resolvedLoc).toBeNull();
  });

  it('ambiguous: two candidates tied at the top score', () => {
    const r = resolveAnchor('пилюля', anchor(), seen('src/Sidebar.tsx:10:5'), [
      el({ loc: 'a.tsx:1:1' }),
      el({ loc: 'b.tsx:2:2' })
    ]);
    expect(r.verdict).toBe('ambiguous');
    expect(r.candidates).toHaveLength(2);
  });

  it('unverifiable: anchor has no strong attr and no text', () => {
    const a = anchor({ attrs: {}, text: undefined });
    const r = resolveAnchor('x', a, seen(null), [el()]);
    expect(r.verdict).toBe('unverifiable');
  });

  it('threshold: comp-only match is rejected (not enough identity)', () => {
    const a = anchor({ attrs: {}, text: undefined, comp: 'NavItem' });
    // anchor unverifiable (no strong attr, no text) -> unverifiable, never matches on comp alone
    const r = resolveAnchor('x', a, seen(null), [el({ attrs: {}, text: undefined })]);
    expect(r.verdict).toBe('unverifiable');
  });

  it('comp + text clears the threshold when no strong attr exists', () => {
    const a = anchor({ attrs: {} });
    const r = resolveAnchor('x', a, seen('src/Sidebar.tsx:10:5'), [el({ attrs: {} })]);
    expect(r.verdict).toBe('resolved');
  });

  it('scoring: testid match outranks a text-only candidate', () => {
    const a = anchor();
    const r = resolveAnchor('x', a, seen('src/Sidebar.tsx:10:5'), [
      el({ loc: 'strong.tsx:1:1' }), // full testid match
      el({ loc: 'weak.tsx:2:2', attrs: {}, comp: 'NavItem' }) // comp+text only
    ]);
    expect(r.verdict).toBe('moved');
    expect(r.resolvedLoc).toBe('strong.tsx:1:1');
  });

  it('null lastSeen.loc with a unique match resolves (loc to be filled by --fix)', () => {
    const r = resolveAnchor('x', anchor(), seen(null), [el({ loc: 'src/New.tsx:3:3' })]);
    expect(r.verdict).toBe('resolved');
    expect(r.lastSeenLoc).toBeNull();
    expect(r.resolvedLoc).toBe('src/New.tsx:3:3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/resolveAnchor.test.ts`
Expected: FAIL — `Failed to resolve import './resolveAnchor'`.

- [ ] **Step 3: Write the implementation**

Create `src/resolveAnchor.ts`:

```ts
import type { AnnotationAnchor, AnnotationLastSeen, DriftEntry, StaticElement } from './types';

const STRONG = ['data-testid', 'id', 'href', 'name'] as const;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function textMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Is `needle` an ordered subsequence of `hay`? Both are root→leaf component chains. */
function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) {
    if (i < needle.length && h === needle[i]) i++;
  }
  return i === needle.length;
}

function strongMatch(anchor: AnnotationAnchor, el: StaticElement): boolean {
  const aa = anchor.attrs ?? {};
  return STRONG.some((k) => Boolean(aa[k]) && el.attrs[k] === aa[k]);
}

/** A candidate counts only with a strong id signal, or with comp AND text together. */
function meetsThreshold(anchor: AnnotationAnchor, el: StaticElement): boolean {
  if (strongMatch(anchor, el)) return true;
  return Boolean(anchor.comp && el.comp === anchor.comp && anchor.text && el.text && textMatch(anchor.text, el.text));
}

/** Can the anchor be checked statically at all? Needs a strong literal attr or some text. */
function verifiable(anchor: AnnotationAnchor): boolean {
  const aa = anchor.attrs ?? {};
  return STRONG.some((k) => Boolean(aa[k])) || Boolean(anchor.text);
}

function score(anchor: AnnotationAnchor, el: StaticElement): number {
  const aa = anchor.attrs ?? {};
  let s = 0;
  if (aa['data-testid'] && el.attrs['data-testid'] === aa['data-testid']) s += 100;
  if (aa.id && el.attrs.id === aa.id) s += 60;
  if (aa.href && el.attrs.href === aa.href) s += 50;
  if (aa.name && el.attrs.name === aa.name) s += 50;
  if (anchor.comp && el.comp === anchor.comp) s += 20;
  if (anchor.text && el.text && textMatch(anchor.text, el.text)) s += 15;
  if (anchor.path?.length && el.path.length && isSubsequence(anchor.path, el.path)) s += 10;
  if (aa.type && el.attrs.type === aa.type) s += 5;
  return s;
}

export function resolveAnchor(
  name: string,
  anchor: AnnotationAnchor,
  lastSeen: AnnotationLastSeen,
  elements: StaticElement[]
): DriftEntry {
  const base = { name, lastSeenLoc: lastSeen.loc, resolvedLoc: null as string | null, candidates: [] as { loc: string; score: number }[] };

  if (!verifiable(anchor)) return { ...base, verdict: 'unverifiable' };

  const scored = elements
    .filter((el) => meetsThreshold(anchor, el))
    .map((el) => ({ loc: el.loc, score: score(anchor, el) }))
    .sort((a, b) => b.score - a.score || (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

  if (scored.length === 0) return { ...base, verdict: 'missing' };

  const top = scored[0];
  if (scored.length > 1 && scored[1].score === top.score) {
    return { ...base, verdict: 'ambiguous', candidates: scored.filter((c) => c.score === top.score) };
  }

  const candidates = [top];
  if (lastSeen.loc != null && top.loc !== lastSeen.loc) {
    return { ...base, verdict: 'moved', resolvedLoc: top.loc, candidates };
  }
  return { ...base, verdict: 'resolved', resolvedLoc: top.loc, candidates };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/resolveAnchor.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resolveAnchor.ts src/resolveAnchor.test.ts
git commit -m "feat(drift): add resolveAnchor scoring + verdicts"
```

---

## Task 3: `staticAnchors` — AST extraction from source

**Files:**
- Create: `src/staticAnchors.ts`
- Test: `src/staticAnchors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/staticAnchors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { staticAnchors } from './staticAnchors';

describe('staticAnchors', () => {
  it('extracts loc, comp, literal attrs and text from a host element', () => {
    const src = `
      export function NavItem() {
        return <a data-testid="nav-rubrics" href="/rubrics">Рубрики</a>;
      }
    `;
    const els = staticAnchors('src/NavItem.tsx', src);
    const a = els.find((e) => e.attrs['data-testid'] === 'nav-rubrics');
    expect(a).toBeDefined();
    expect(a?.comp).toBe('NavItem');
    expect(a?.attrs.href).toBe('/rubrics');
    expect(a?.text).toBe('Рубрики');
    expect(a?.loc.startsWith('src/NavItem.tsx:')).toBe(true);
  });

  it('omits dynamic attrs and dynamic text', () => {
    const src = `
      export function Card({ url, label }) {
        return <a href={url}>{label}</a>;
      }
    `;
    const [a] = staticAnchors('src/Card.tsx', src);
    expect(a.attrs.href).toBeUndefined();
    expect(a.text).toBeUndefined();
  });

  it('builds the component path root→leaf across nesting', () => {
    const src = `
      function Sidebar() {
        return <nav><button data-testid="b">x</button></nav>;
      }
    `;
    const btn = staticAnchors('src/Sidebar.tsx', src).find((e) => e.attrs['data-testid'] === 'b');
    expect(btn?.path).toEqual(['Sidebar']);
    expect(btn?.comp).toBe('Sidebar');
  });

  it('only emits host (lowercase) elements, not component tags', () => {
    const src = `
      function App() {
        return <div><NavItem /></div>;
      }
    `;
    const els = staticAnchors('src/App.tsx', src);
    expect(els.every((e) => e.loc.includes('src/App.tsx'))).toBe(true);
    // <div> is a host element; <NavItem /> is not.
    expect(els).toHaveLength(1);
  });

  it('returns [] for a file with no JSX', () => {
    expect(staticAnchors('src/util.ts', 'export const x = 1;')).toEqual([]);
  });

  it('throws on unparseable source', () => {
    expect(() => staticAnchors('src/bad.tsx', 'export function () { return <div>;')).toThrow();
  });

  it('collapses whitespace and caps text at 160 code points', () => {
    const long = 'a'.repeat(200);
    const src = `function F() { return <p>${long}</p>; }`;
    const [p] = staticAnchors('src/F.tsx', src);
    expect(p.text?.endsWith('…')).toBe(true);
    expect([...(p.text ?? '')].length).toBe(161); // 160 + ellipsis
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/staticAnchors.test.ts`
Expected: FAIL — `Failed to resolve import './staticAnchors'`.

- [ ] **Step 3: Write the implementation**

Create `src/staticAnchors.ts`:

```ts
import { parseSync, traverse } from '@babel/core';
import type { NodePath, types as BabelTypes } from '@babel/core';
import { isHostElement, nearestComponentName } from './stampLocBabel';
import type { StaticElement } from './types';

const ATTR_WHITELIST = ['id', 'data-testid', 'name', 'href', 'type'];
const TEXT_CAP = 160;
const PATH_CAP = 4;

function parserPlugins(file: string): ('jsx' | 'typescript')[] {
  if (file.endsWith('.tsx')) return ['jsx', 'typescript'];
  if (file.endsWith('.ts')) return ['typescript'];
  return ['jsx']; // .jsx, .js
}

function literalAttrs(open: BabelTypes.JSXOpeningElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of open.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
    if (!ATTR_WHITELIST.includes(a.name.name)) continue;
    const v = a.value;
    if (v?.type === 'StringLiteral') out[a.name.name] = v.value;
    else if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'StringLiteral') {
      out[a.name.name] = v.expression.value;
    }
  }
  return out;
}

function literalText(node: BabelTypes.JSXElement): string | undefined {
  const parts: string[] = [];
  const walk = (children: BabelTypes.JSXElement['children']): void => {
    for (const c of children) {
      if (c.type === 'JSXText') parts.push(c.value);
      else if (c.type === 'JSXElement') walk(c.children);
      else if (c.type === 'JSXFragment') walk(c.children);
      // JSXExpressionContainer / JSXSpreadChild → dynamic, skipped
    }
  };
  walk(node.children);
  const raw = parts.join('').replace(/\s+/g, ' ').trim();
  if (!raw) return undefined;
  const cp = [...raw];
  return cp.length > TEXT_CAP ? `${cp.slice(0, TEXT_CAP).join('')}…` : raw;
}

function componentPath(path: NodePath<BabelTypes.JSXElement>): string[] {
  const chain: string[] = [];
  let p: NodePath | null = path;
  while (p) {
    if (p.isJSXElement() && isHostElement(p.node.openingElement.name)) {
      const c = nearestComponentName(p);
      if (c && chain[chain.length - 1] !== c) chain.push(c);
    }
    p = p.parentPath;
  }
  return chain.slice(0, PATH_CAP).reverse();
}

/**
 * Parse `source` and return every JSX host element as a StaticElement (AST analog of
 * extractSemantics). `file` is a relative POSIX path; it is used verbatim in `loc` and to pick
 * parser plugins. Throws if the source cannot be parsed.
 */
export function staticAnchors(file: string, source: string): StaticElement[] {
  const ast = parseSync(source, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    parserOpts: { plugins: parserPlugins(file), errorRecovery: false }
  });
  if (!ast) throw new Error(`failed to parse ${file}`);

  const out: StaticElement[] = [];
  traverse(ast, {
    JSXElement(path) {
      const open = path.node.openingElement;
      if (!isHostElement(open.name)) return;
      const loc = open.loc;
      if (!loc) return;
      const el: StaticElement = {
        file,
        loc: `${file}:${loc.start.line}:${loc.start.column + 1}`,
        comp: nearestComponentName(path),
        path: componentPath(path),
        attrs: literalAttrs(open)
      };
      const text = literalText(path.node);
      if (text) el.text = text;
      out.push(el);
    }
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/staticAnchors.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck (Babel types are fiddly — verify now)**

Run: `npm run typecheck`
Expected: PASS. If `traverse`/`parseSync` import types complain, confirm `@types/babel__core` is installed (it is, in devDependencies) and that the value import (`import { parseSync, traverse } from '@babel/core'`) is kept separate from the `import type { NodePath, types as BabelTypes } from '@babel/core'` line.

- [ ] **Step 6: Commit**

```bash
git add src/staticAnchors.ts src/staticAnchors.test.ts
git commit -m "feat(drift): add staticAnchors AST extraction"
```

---

## Task 4: `collectSourceFiles` — dependency-free source walk

**Files:**
- Create: `src/collectSourceFiles.ts`
- Test: `src/collectSourceFiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/collectSourceFiles.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collectSourceFiles.test.ts`
Expected: FAIL — `Failed to resolve import './collectSourceFiles'`.

- [ ] **Step 3: Write the implementation**

Create `src/collectSourceFiles.ts`:

```ts
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const EXTS = new Set(['.jsx', '.tsx', '.js', '.ts']);
const SKIP_DIRS = new Set(['node_modules', 'dist']);

function isSource(name: string): boolean {
  if (!EXTS.has(extname(name))) return false;
  if (name.endsWith('.d.ts')) return false;
  if (/\.test\.[jt]sx?$/.test(name)) return false;
  return true;
}

/**
 * Recursively collect source files under `root`, returning relative POSIX paths. Skips
 * node_modules/dist, dotdirs (.git, .semantic-inspector), test files and .d.ts. When `include`
 * is given, only files whose relative path starts with one of the prefixes are returned.
 */
export function collectSourceFiles(root: string, include?: string[]): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(join(absDir, e.name), rel);
      } else if (e.isFile() && isSource(e.name)) {
        if (!include?.length || include.some((p) => rel === p || rel.startsWith(`${p}/`))) out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collectSourceFiles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/collectSourceFiles.ts src/collectSourceFiles.test.ts
git commit -m "feat(drift): add collectSourceFiles walk"
```

---

## Task 5: `driftCheck` — orchestration

**Files:**
- Create: `src/driftCheck.ts`
- Test: `src/driftCheck.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/driftCheck.test.ts`:

```ts
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
    expect(driftCheck(dir)).toEqual({ entries: [], drifted: 0, ok: 0 });
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

  it('skips an unparseable file with a warning, does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeSrc('src/Bad.tsx', 'function Bad( { return <div>;');
    writeSrc('src/F.tsx', 'function F() { return <button data-testid="save">Save</button>; }');
    writeAnnotations(dir, annoFile('src/F.tsx:1:23'));
    expect(() => driftCheck(dir)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

> Note: the exact `:col` in `src/F.tsx:1:23` must match what Babel reports for that `<button>`. If the `resolved` test does not match, run `driftCheck` once and read `entries[0].resolvedLoc` to get the precise column, then use it in the fixture. (This is expected — the col depends on source formatting.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/driftCheck.test.ts`
Expected: FAIL — `Failed to resolve import './driftCheck'`.

- [ ] **Step 3: Write the implementation**

Create `src/driftCheck.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAnnotations } from './annotationStore';
import { collectSourceFiles } from './collectSourceFiles';
import { resolveAnchor } from './resolveAnchor';
import { staticAnchors } from './staticAnchors';
import type { DriftResult, StaticElement } from './types';

const DRIFTED = new Set(['moved', 'missing', 'ambiguous']);

/** Re-resolve every annotation against the current source tree under `root`. */
export function driftCheck(root: string, opts: { include?: string[] } = {}): DriftResult {
  const file = readAnnotations(root);
  const names = Object.keys(file.annotations);
  if (names.length === 0) return { entries: [], drifted: 0, ok: 0 };

  const elements: StaticElement[] = [];
  for (const rel of collectSourceFiles(root, opts.include)) {
    let source: string;
    try {
      source = readFileSync(resolve(root, rel), 'utf8');
    } catch {
      continue;
    }
    try {
      elements.push(...staticAnchors(rel, source));
    } catch {
      console.warn(`semantic-inspector: skipped ${rel} (parse error)`);
    }
  }

  const entries = names.map((name) => {
    const a = file.annotations[name];
    return resolveAnchor(name, a.anchor, a.lastSeen, elements);
  });
  const drifted = entries.filter((e) => DRIFTED.has(e.verdict)).length;
  const ok = entries.filter((e) => e.verdict === 'resolved').length;
  return { entries, drifted, ok };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/driftCheck.test.ts`
Expected: PASS (4 tests). If the `resolved` case fails on the column, fix the fixture loc per the note above, then re-run.

- [ ] **Step 5: Commit**

```bash
git add src/driftCheck.ts src/driftCheck.test.ts
git commit -m "feat(drift): add driftCheck orchestration"
```

---

## Task 6: `driftReport` — human + JSON formatting

**Files:**
- Create: `src/driftReport.ts`
- Test: `src/driftReport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/driftReport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatHuman, formatJson } from './driftReport';
import type { DriftResult } from './types';

const result: DriftResult = {
  drifted: 2,
  ok: 1,
  entries: [
    { name: 'ok1', verdict: 'resolved', lastSeenLoc: 'a.tsx:1:1', resolvedLoc: 'a.tsx:1:1', candidates: [] },
    { name: 'mv', verdict: 'moved', lastSeenLoc: 'b.tsx:1:1', resolvedLoc: 'b.tsx:9:1', candidates: [{ loc: 'b.tsx:9:1', score: 100 }] },
    { name: 'gone', verdict: 'missing', lastSeenLoc: 'c.tsx:1:1', resolvedLoc: null, candidates: [] },
    { name: 'amb', verdict: 'ambiguous', lastSeenLoc: 'd.tsx:1:1', resolvedLoc: null, candidates: [{ loc: 'd.tsx:2:2', score: 50 }, { loc: 'd.tsx:3:3', score: 50 }] },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/driftReport.test.ts`
Expected: FAIL — `Failed to resolve import './driftReport'`.

- [ ] **Step 3: Write the implementation**

Create `src/driftReport.ts`:

```ts
import type { DriftEntry, DriftResult, DriftVerdict } from './types';

const MARK: Record<DriftVerdict, string> = {
  resolved: '✓',
  moved: '~',
  missing: '✗',
  ambiguous: '?',
  unverifiable: '·'
};
const LABEL: Record<DriftVerdict, string> = {
  resolved: 'resolved',
  moved: 'moved',
  missing: 'missing',
  ambiguous: 'ambiguous',
  unverifiable: 'unverify'
};

function shortLoc(loc: string | null): string {
  if (!loc) return '—';
  const parts = loc.split(':');
  return parts.length >= 3 ? `:${parts.slice(1).join(':')}` : loc;
}

function detail(e: DriftEntry): string {
  switch (e.verdict) {
    case 'resolved':
      return e.resolvedLoc ?? '';
    case 'moved':
      return `${e.resolvedLoc}  (was ${shortLoc(e.lastSeenLoc)})`;
    case 'missing':
      return `(was ${e.lastSeenLoc ?? '—'})`;
    case 'ambiguous':
      return e.candidates.map((c) => c.loc).join(' · ');
    case 'unverifiable':
      return 'no stable signal — add data-testid';
  }
}

function isFixable(e: DriftEntry): boolean {
  return Boolean(e.resolvedLoc) && e.resolvedLoc !== e.lastSeenLoc;
}

export function formatHuman(result: DriftResult): string {
  const total = result.entries.length;
  if (total === 0) return 'semantic-inspector: no annotations found.';

  const lines: string[] = [
    `semantic-inspector drift — ${total} annotation${total === 1 ? '' : 's'}, ${result.drifted} drifted`,
    ''
  ];
  for (const e of result.entries) {
    lines.push(`  ${MARK[e.verdict]} ${LABEL[e.verdict].padEnd(10)} ${e.name.padEnd(14)} ${detail(e)}`);
  }
  lines.push('');
  const fixable = result.entries.filter(isFixable).length;
  const tail = fixable ? ` (${fixable} fixable). Run --fix to relock.` : '.';
  lines.push(`${result.drifted} drifted${tail}`);
  return lines.join('\n');
}

export function formatJson(result: DriftResult): string {
  return JSON.stringify({ drifted: result.drifted, ok: result.ok, entries: result.entries }, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/driftReport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/driftReport.ts src/driftReport.test.ts
git commit -m "feat(drift): add human + json report formatting"
```

---

## Task 7: `driftFix` — relock safe drifts

**Files:**
- Create: `src/driftFix.ts`
- Test: `src/driftFix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/driftFix.test.ts`:

```ts
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
  entries: [{ name: 'btn', verdict: 'moved', lastSeenLoc: 'src/F.tsx:1:1', resolvedLoc: 'src/F.tsx:9:3', candidates: [] }]
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
    const n = driftFix(dir, { drifted: 1, ok: 1, entries: [
      { name: 'btn', verdict: 'resolved', lastSeenLoc: 'src/F.tsx:1:1', resolvedLoc: 'src/F.tsx:1:1', candidates: [] }
    ] }, '2026-02-02T00:00:00.000Z');
    expect(n).toBe(0);
    expect(readAnnotations(dir).annotations.btn.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/driftFix.test.ts`
Expected: FAIL — `Failed to resolve import './driftFix'`.

- [ ] **Step 3: Write the implementation**

Create `src/driftFix.ts`:

```ts
import { readAnnotations, upsert, writeAnnotations } from './annotationStore';
import type { AnnotationInput, DriftResult } from './types';

/**
 * Relock every fixable entry (resolved at a loc different from the recorded one — covers `moved`
 * and unstamped-but-now-found anchors) by updating its lastSeen + updatedAt. Anchor is never
 * changed. Persists via writeAnnotations (regenerates the .md mirror). Returns the count fixed.
 */
export function driftFix(root: string, result: DriftResult, now: string): number {
  const fixable = result.entries.filter((e) => Boolean(e.resolvedLoc) && e.resolvedLoc !== e.lastSeenLoc);
  if (fixable.length === 0) return 0;

  let file = readAnnotations(root);
  for (const e of fixable) {
    const a = file.annotations[e.name];
    if (!a) continue;
    const loc = e.resolvedLoc as string;
    const input: AnnotationInput = {
      name: a.name,
      tags: a.tags,
      note: a.note,
      anchor: a.anchor,
      lastSeen: { file: loc.split(':')[0], loc }
    };
    file = upsert(file, input, now);
  }
  writeAnnotations(root, file);
  return fixable.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/driftFix.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/driftFix.ts src/driftFix.test.ts
git commit -m "feat(drift): add driftFix relock"
```

---

## Task 8: `driftCli` — arg parsing, wiring, exit codes

**Files:**
- Create: `src/driftCli.ts`
- Test: `src/driftCli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/driftCli.test.ts`:

```ts
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
    // Element present but at a different column than recorded -> moved -> fixable.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/driftCli.test.ts`
Expected: FAIL — `Failed to resolve import './driftCli'`.

- [ ] **Step 3: Write the implementation**

Create `src/driftCli.ts`:

```ts
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { driftCheck } from './driftCheck';
import { driftFix } from './driftFix';
import { formatHuman, formatJson } from './driftReport';
import type { DriftResult } from './types';

const USAGE = `semantic-inspector check — detect drift between annotations.json and source

Usage: semantic-inspector check [options]

Options:
  --fix            relock safe (moved) entries and persist
  --json           print the JSON report instead of the human table
  --root <dir>     project root (default: cwd)
  --include <p>    restrict scan to a path prefix under root (repeatable)
  --allow-moved    treat moved as a warning (exit 0)
  --strict         treat unverifiable as drift (exit 1)
  --help           show this help
  --version        print version`;

function version(): string {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function exitCode(result: DriftResult, opts: { allowMoved: boolean; strict: boolean }): number {
  for (const e of result.entries) {
    if (e.verdict === 'missing' || e.verdict === 'ambiguous') return 1;
    if (e.verdict === 'moved' && !opts.allowMoved) return 1;
    if (e.verdict === 'unverifiable' && opts.strict) return 1;
  }
  return 0;
}

/** Parse argv, run the drift pipeline, print, and return an exit code. Never calls process.exit. */
export async function runCli(argv: string[], now: string = new Date().toISOString()): Promise<number> {
  let values: {
    fix?: boolean;
    json?: boolean;
    root?: string;
    include?: string[];
    'allow-moved'?: boolean;
    strict?: boolean;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        fix: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        root: { type: 'string' },
        include: { type: 'string', multiple: true },
        'allow-moved': { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false }
      }
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    console.error(`semantic-inspector: ${errMessage(e)}`);
    console.error(USAGE);
    return 2;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }
  if (positionals.length > 0 && positionals[0] !== 'check') {
    console.error(`semantic-inspector: unknown command '${positionals[0]}'`);
    console.error(USAGE);
    return 2;
  }

  const root = resolve(values.root ?? process.cwd());
  try {
    let result = driftCheck(root, { include: values.include });
    if (values.fix && result.entries.length > 0) {
      driftFix(root, result, now);
      result = driftCheck(root, { include: values.include });
    }
    console.log(values.json ? formatJson(result) : formatHuman(result));
    return exitCode(result, { allowMoved: Boolean(values['allow-moved']), strict: Boolean(values.strict) });
  } catch (e) {
    console.error(`semantic-inspector: ${errMessage(e)}`);
    return 2;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/driftCli.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/driftCli.ts src/driftCli.test.ts
git commit -m "feat(drift): add driftCli arg parsing + exit codes"
```

---

## Task 9: bin shim + packaging + build smoke

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (add `bin`)
- Modify: `tsup.config.ts` (add `cli` entry)
- Modify: `vitest.config.ts` (exclude `src/cli.ts` from coverage)

- [ ] **Step 1: Create the bin shim `src/cli.ts`**

```ts
#!/usr/bin/env node

// `driftCli` statically imports `@babel/core`. Importing it *dynamically* here keeps that resolution
// inside the try/catch, so a missing peer dependency produces a friendly hint instead of a raw
// ERR_MODULE_NOT_FOUND stack trace at process startup (a static import would throw before any code runs).
async function main(): Promise<void> {
  try {
    const { runCli } = await import('./driftCli');
    process.exit(await runCli(process.argv.slice(2)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/@babel\/core/.test(msg)) {
      console.error('semantic-inspector: requires @babel/core — npm i -D @babel/core');
    } else {
      console.error(`semantic-inspector: ${msg}`);
    }
    process.exit(2);
  }
}

void main();
```

> Note: the **dynamic** `await import('./driftCli')` is load-bearing — it defers resolving the
> `@babel/core` static-import chain until inside the try/catch. Keep this file tiny — it is excluded
> from coverage.

- [ ] **Step 2: Add the `bin` field to `package.json`**

In `package.json`, add a top-level `"bin"` entry (after `"types"`):

```json
  "bin": {
    "semantic-inspector": "./dist/cli.js"
  },
```

- [ ] **Step 3: Add the cli entry to `tsup.config.ts`**

Change the `entry` block in `tsup.config.ts` to:

```ts
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    babel: 'src/stampLocBabel.ts',
    cli: 'src/cli.ts'
  },
```

(`@babel/core` is already in `external` — no change needed. esbuild preserves the `#!/usr/bin/env node` shebang at the top of `src/cli.ts`.)

- [ ] **Step 4: Exclude the shim from coverage in `vitest.config.ts`**

Change the coverage `exclude` array to add `'src/cli.ts'`:

```ts
      exclude: ['src/**/*.test.{ts,tsx}', 'src/Overlay.tsx', 'src/index.ts', 'src/types.ts', 'src/cli.ts'],
```

- [ ] **Step 5: Build and smoke-test the bin**

Run: `npm run build`
Expected: build succeeds; `dist/cli.js` exists.

Run: `head -1 dist/cli.js`
Expected: `#!/usr/bin/env node`

Run: `node dist/cli.js --help`
Expected: prints the usage text, exit 0.

Run: `node dist/cli.js --version`
Expected: prints `0.2.0` (the current package version).

Run: `node dist/cli.js check --root . --json`
Expected: valid JSON (this repo has no `.semantic-inspector/annotations.json`, so output is the "no annotations" path — `formatHuman` short-circuits, but with `--json` an empty result prints `{ "drifted": 0, "ok": 0, "entries": [] }`); exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts package.json tsup.config.ts vitest.config.ts
git commit -m "feat(drift): add bin shim, wire build + packaging"
```

---

## Task 10: README + changeset + full verification

**Files:**
- Modify: `README.md` (add "Drift detection (CI)" section)
- Create: `.changeset/graph-drift.md`

- [ ] **Step 1: Add the README section**

Add a new section to `README.md` after the "Annotate mode (opt-in)" section (before "Three entry points"):

````markdown
## Drift detection (CI)

Annotations anchor on durable signals, but code still changes. `semantic-inspector check` re-resolves
every entry in `.semantic-inspector/annotations.json` against your current source (static Babel
analysis — no browser, no build) and reports drift, so CI can block a merge until the graph is
updated, and an AI agent can re-anchor what moved.

```bash
npx semantic-inspector check            # human table, exits 1 on drift
npx semantic-inspector check --json     # machine report for an AI agent
npx semantic-inspector check --fix      # relock entries that moved to a new, unique location
```

Each annotation gets a verdict:

| verdict | meaning | CI (default) | `--fix` |
| --- | --- | --- | --- |
| `resolved` | found at the recorded location | pass | — |
| `moved` | found, but at a new location (stale `lastSeen.loc`) | **fail** | relocks it |
| `missing` | no matching element — deleted or renamed | **fail** | re-anchor by hand/AI |
| `ambiguous` | several equally-good matches | **fail** | disambiguate by hand/AI |
| `unverifiable` | the anchor has no statically-checkable signal | pass (warn) | add a `data-testid` |

Flags: `--root <dir>` (default cwd), `--include <prefix>` (repeatable scan filter), `--allow-moved`
(moved → warning), `--strict` (unverifiable → failure). Requires `@babel/core` (already present if you
use the Vite/Babel stamp).

Example CI step — fail the job on drift; the agent then reads `--json`, relocks (`--fix`) or
re-anchors, and re-runs to green:

```yaml
- run: npx semantic-inspector check
```

**Static limits:** anchors whose only signals are dynamic in source (e.g. `href={url}`,
`{interpolatedText}`) resolve as `unverifiable`. Adding a `data-testid` makes an element robustly
anchorable — it is the most stable signal in the resolution order.
````

- [ ] **Step 2: Create the changeset**

Create `.changeset/graph-drift.md`:

```markdown
---
"semantic-inspector": minor
---

Add `semantic-inspector check` CLI: detects drift between `.semantic-inspector/annotations.json` and
the current source via static Babel analysis. Verdicts (resolved/moved/missing/ambiguous/
unverifiable), `--json` report for AI agents, `--fix` to relock moved entries, and a non-zero exit to
gate CI.
```

- [ ] **Step 3: Full verification — typecheck, lint, tests + coverage, build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS (biome clean). If biome reports issues, run `npm run lint:fix` and re-check.

Run: `npm run test:cov`
Expected: all tests PASS; coverage thresholds met (lines/functions/statements ≥ 80, branches ≥ 70). The new pure modules (`resolveAnchor`, `driftReport`) and the temp-dir-backed modules carry the coverage.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md .changeset/graph-drift.md
git commit -m "docs(drift): document the check CLI; add changeset"
```

---

## Done

All ten tasks complete: drift CLI with static anchor re-resolution, verdicts, `--json` report,
`--fix` relock, CI exit codes, docs, and a changeset — matching the approved design spec.
