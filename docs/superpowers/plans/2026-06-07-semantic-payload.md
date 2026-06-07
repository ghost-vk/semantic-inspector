# Semantic Payload (opt-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `semantic` prop that enriches the clipboard text copied on click with the element's visible label, sibling index, component path, and key attributes.

**Architecture:** A new pure module `extractSemantics(el)` reads semantic signals from a clicked element. It runs only at click time (never per mousemove), so hover stays cheap and the overlay/screenshot paths are untouched. `useInspector` picks a multi-line formatter when `semantic` is on; default output is unchanged. `resolveComp` is factored out of `resolveTarget` and reused.

**Tech Stack:** TypeScript, React 18/19, Vitest + happy-dom, Biome, tsup, Changesets.

**Spec:** `docs/superpowers/specs/2026-06-07-semantic-payload-design.md`

---

## File structure

| File | Responsibility | Action |
| ---- | -------------- | ------ |
| `src/types.ts` | Public types; add `SemanticInfo`, `semantic` prop, widen `formatText` | Modify |
| `src/index.ts` | Barrel; export `SemanticInfo` type | Modify |
| `src/resolveTarget.ts` | Hover target + comp/loc resolution; export `resolveComp` | Modify |
| `src/resolveTarget.test.ts` | Add `resolveComp` test | Modify |
| `src/extractSemantics.ts` | Clicked element → `SemanticInfo` (pure) | Create |
| `src/extractSemantics.test.ts` | Unit tests for extraction | Create |
| `src/useInspector.ts` | Wire formatter + `semantic` flag into click handler | Modify |
| `src/useInspector.test.tsx` | Add semantic-mode tests | Modify |
| `src/SemanticInspector.tsx` | Forward `semantic` prop to `useInspector` | Modify |
| `src/SemanticInspector.test.tsx` | Add forwarding integration test | Modify |
| `.changeset/semantic-payload.md` | Changeset (minor) | Create |
| `README.md` | Document the `semantic` prop | Modify |

`resolveComp` is exported from its module for intra-`src` import but is **not** re-exported from `index.ts` — internal helpers stay unexported (CONTRIBUTING).

---

### Task 1: Public types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `SemanticInfo` to `src/types.ts`**

Insert directly after the `LocInfo` interface:

```ts
/**
 * LocInfo plus semantic signals about the clicked element. All extra fields are optional and
 * only populated when `semantic` is enabled (and when meaningful — e.g. index/total are omitted
 * for a lone element). Superset of LocInfo, so an existing `formatText: (t) => t.comp` keeps
 * working unchanged.
 */
export interface SemanticInfo extends LocInfo {
  /** Visible label: textContent, whitespace-collapsed, trimmed, capped at 160 (+ "…"). */
  text?: string;
  /** 1-based position among same-tag + same-data-comp siblings. Omitted if total <= 1. */
  index?: number;
  /** Count of same-tag + same-data-comp siblings. Omitted if <= 1. */
  total?: number;
  /** data-comp ancestor chain, root→leaf, consecutive duplicates collapsed, max 4 entries. */
  path?: string[];
  /** Whitelisted attributes present on the element: id, data-testid, name, href, type. */
  attrs?: Record<string, string>;
}
```

- [ ] **Step 2: Add the `semantic` prop and widen `formatText` in `SemanticInspectorProps`**

In `src/types.ts`, replace the existing `formatText` doc+field:

```ts
  /** Formats the clipboard text. Default: `${comp} — ${loc}` (or `${comp}` when loc is null). */
  formatText?: (t: LocInfo) => string;
```

with:

```ts
  /**
   * Enrich the copied text with semantic signals (visible text, sibling index, component path,
   * key attributes). Computed at click time only. Default false — copied text is unchanged.
   */
  semantic?: boolean;
  /**
   * Formats the clipboard text. Receives `SemanticInfo`; the extra fields are populated only when
   * `semantic` is true. Default: `${comp} — ${loc}` (single line), or the multi-line semantic
   * block when `semantic` is true. Backward compatible — `LocInfo` is a subset of `SemanticInfo`.
   */
  formatText?: (t: SemanticInfo) => string;
```

- [ ] **Step 3: Export `SemanticInfo` from `src/index.ts`**

Replace the type export line:

```ts
export type { CopyKind, InspectTarget, LocInfo, SemanticInspectorProps, UseInspectorResult } from './types';
```

with:

```ts
export type { CopyKind, InspectTarget, LocInfo, SemanticInfo, SemanticInspectorProps, UseInspectorResult } from './types';
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). Type-only change; `SemanticInfo extends LocInfo` keeps `formatText` backward compatible.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat(types): add SemanticInfo and opt-in semantic prop"
```

---

### Task 2: Factor out `resolveComp`

**Files:**
- Modify: `src/resolveTarget.ts`
- Test: `src/resolveTarget.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('resolveTarget', ...)` block in `src/resolveTarget.test.ts` (and add `resolveComp` to the import at the top: `import { resolveComp, resolveTarget } from './resolveTarget';`):

```ts
  it('resolveComp reads data-comp directly from the given element', () => {
    document.body.innerHTML = `<button id="b" data-comp="NavItem">x</button>`;
    expect(resolveComp(document.getElementById('b') as Element)).toBe('NavItem');
  });

  it('resolveComp falls back to the tag name when nothing is stamped', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    expect(resolveComp(document.getElementById('b') as Element)).toBe('button');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/resolveTarget.test.ts`
Expected: FAIL — `resolveComp` is not exported (`resolveComp is not a function` / import error).

- [ ] **Step 3: Extract `resolveComp` in `src/resolveTarget.ts`**

Replace the `resolveTarget` function body so comp resolution lives in an exported helper:

```ts
/**
 * Resolve a component name for an element: data-comp → React fiber displayName → file base
 * (from data-loc) → tag name. Operates on the element as-is (no ancestor walk).
 */
export function resolveComp(el: Element): string {
  return el.getAttribute(COMP_ATTR) ?? fiberName(el) ?? fallbackName(el, el.getAttribute(LOC_ATTR));
}

export function resolveTarget(el: Element | null): InspectTarget | null {
  if (!el) return null;
  const target = el.closest(`[${LOC_ATTR}]`) ?? el;
  const loc = target.getAttribute(LOC_ATTR);
  return { comp: resolveComp(target), loc, el: target, rect: target.getBoundingClientRect() };
}
```

`fiberName` and `fallbackName` stay private (unchanged) below.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/resolveTarget.test.ts`
Expected: PASS — all existing `resolveTarget` tests plus the two new `resolveComp` tests.

- [ ] **Step 5: Commit**

```bash
git add src/resolveTarget.ts src/resolveTarget.test.ts
git commit -m "refactor(resolveTarget): extract reusable resolveComp"
```

---

### Task 3: `extractSemantics` module

**Files:**
- Create: `src/extractSemantics.ts`
- Test: `src/extractSemantics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/extractSemantics.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { extractSemantics } from './extractSemantics';

const el = (id: string): Element => document.getElementById(id) as Element;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('extractSemantics — text', () => {
  it('collapses whitespace and trims the visible label', () => {
    document.body.innerHTML = `<button id="b" data-comp="Btn">  Save\n  changes </button>`;
    expect(extractSemantics(el('b')).text).toBe('Save changes');
  });

  it('truncates at 160 chars with an ellipsis', () => {
    document.body.innerHTML = `<button id="b" data-comp="Btn">${'x'.repeat(200)}</button>`;
    const t = extractSemantics(el('b')).text as string;
    expect(t.length).toBe(161);
    expect(t.endsWith('…')).toBe(true);
  });

  it('omits text when empty', () => {
    document.body.innerHTML = `<div id="d" data-comp="D"></div>`;
    expect(extractSemantics(el('d')).text).toBeUndefined();
  });
});

describe('extractSemantics — index/total', () => {
  it('reports 1-based index among same tag+comp siblings', () => {
    document.body.innerHTML = `<nav>${[0, 1, 2, 3, 4]
      .map((i) => `<button data-comp="NavItem">item${i}</button>`)
      .join('')}</nav>`;
    const second = document.querySelectorAll('nav > button')[1];
    const r = extractSemantics(second);
    expect(r.index).toBe(2);
    expect(r.total).toBe(5);
  });

  it('omits index/total when only one matching sibling', () => {
    document.body.innerHTML = `<nav><button id="b" data-comp="NavItem">solo</button></nav>`;
    const r = extractSemantics(el('b'));
    expect(r.index).toBeUndefined();
    expect(r.total).toBeUndefined();
  });

  it('does not count siblings with a different tag or data-comp', () => {
    document.body.innerHTML =
      `<nav><button id="b" data-comp="NavItem">a</button><button data-comp="Other">b</button><a data-comp="NavItem">c</a></nav>`;
    expect(extractSemantics(el('b')).index).toBeUndefined();
  });
});

describe('extractSemantics — path', () => {
  it('builds the component path root→leaf, dedups consecutive duplicates', () => {
    document.body.innerHTML =
      `<div data-comp="App"><div data-comp="Sidebar"><div data-comp="Sidebar"><button id="b" data-comp="NavItem">x</button></div></div></div>`;
    expect(extractSemantics(el('b')).path).toEqual(['App', 'Sidebar', 'NavItem']);
  });

  it('keeps only the 4 components closest to the leaf when deeper', () => {
    document.body.innerHTML =
      `<div data-comp="A"><div data-comp="B"><div data-comp="C"><div data-comp="D"><button id="b" data-comp="E">x</button></div></div></div></div>`;
    expect(extractSemantics(el('b')).path).toEqual(['B', 'C', 'D', 'E']);
  });

  it('omits path when no data-comp is present anywhere', () => {
    document.body.innerHTML = `<div><button id="b">x</button></div>`;
    expect(extractSemantics(el('b')).path).toBeUndefined();
  });
});

describe('extractSemantics — attrs', () => {
  it('picks only whitelisted attributes that are present', () => {
    document.body.innerHTML =
      `<a id="lnk" data-comp="L" data-testid="nav-rubrics" href="/rubrics" class="x" role="link">R</a>`;
    expect(extractSemantics(el('lnk')).attrs).toEqual({
      id: 'lnk',
      'data-testid': 'nav-rubrics',
      href: '/rubrics'
    });
  });

  it('omits attrs when no whitelisted attribute is present', () => {
    document.body.innerHTML = `<nav><span data-comp="S" class="only">t</span></nav>`;
    expect(extractSemantics(document.querySelector('.only') as Element).attrs).toBeUndefined();
  });
});

describe('extractSemantics — edges', () => {
  it('handles an element with no parent', () => {
    const orphan = document.createElement('button');
    orphan.setAttribute('data-comp', 'Orphan');
    orphan.textContent = 'hi';
    const r = extractSemantics(orphan);
    expect(r.index).toBeUndefined();
    expect(r.comp).toBe('Orphan');
  });

  it('returns tag-name comp and null loc for an unstamped element', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const r = extractSemantics(el('b'));
    expect(r.comp).toBe('button');
    expect(r.loc).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/extractSemantics.test.ts`
Expected: FAIL — `Cannot find module './extractSemantics'`.

- [ ] **Step 3: Implement `src/extractSemantics.ts`**

```ts
import { resolveComp } from './resolveTarget';
import type { SemanticInfo } from './types';

const LOC_ATTR = 'data-loc';
const COMP_ATTR = 'data-comp';
const TEXT_CAP = 160;
const PATH_CAP = 4;
const ATTR_WHITELIST = ['id', 'data-testid', 'name', 'href', 'type'] as const;

/**
 * Read semantic signals from a clicked element into a SemanticInfo. Pure (no DOM mutation, no
 * side effects). Called once per text copy — never on a mousemove frame.
 */
export function extractSemantics(el: Element): SemanticInfo {
  const info: SemanticInfo = { comp: resolveComp(el), loc: el.getAttribute(LOC_ATTR) };
  const text = extractText(el);
  if (text) info.text = text;
  const idx = siblingIndex(el);
  if (idx) {
    info.index = idx.index;
    info.total = idx.total;
  }
  const path = componentPath(el);
  if (path.length) info.path = path;
  const attrs = pickAttrs(el);
  if (attrs) info.attrs = attrs;
  return info;
}

function extractText(el: Element): string | undefined {
  const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return undefined;
  return raw.length > TEXT_CAP ? `${raw.slice(0, TEXT_CAP)}…` : raw;
}

function siblingIndex(el: Element): { index: number; total: number } | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const comp = el.getAttribute(COMP_ATTR);
  const peers = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName && c.getAttribute(COMP_ATTR) === comp
  );
  if (peers.length <= 1) return null;
  return { index: peers.indexOf(el) + 1, total: peers.length };
}

function componentPath(el: Element): string[] {
  // Collect data-comp values leaf→root, collapsing consecutive duplicates.
  const chain: string[] = [];
  let node: Element | null = el;
  while (node) {
    const comp = node.getAttribute(COMP_ATTR);
    if (comp && chain[chain.length - 1] !== comp) chain.push(comp);
    node = node.parentElement;
  }
  // Keep the 4 closest to the leaf (first in leaf→root order), then present root→leaf.
  return chain.slice(0, PATH_CAP).reverse();
}

function pickAttrs(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of ATTR_WHITELIST) {
    const v = el.getAttribute(name);
    if (v != null) out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/extractSemantics.test.ts`
Expected: PASS — all extraction tests green.

- [ ] **Step 5: Commit**

```bash
git add src/extractSemantics.ts src/extractSemantics.test.ts
git commit -m "feat(semantics): add extractSemantics for clicked elements"
```

---

### Task 4: Wire semantic formatting into `useInspector`

**Files:**
- Modify: `src/useInspector.ts`
- Test: `src/useInspector.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/useInspector.test.tsx`, add a `navTree` helper near the existing `stamped` helper (top of file):

```ts
function navTree(): HTMLElement {
  document.body.innerHTML =
    `<nav data-comp="Sidebar" data-loc="src/Sidebar.tsx:1:1"><button data-comp="NavItem" data-loc="src/Sidebar.tsx:90:5" data-testid="nav-stories">Сюжеты</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button></nav>`;
  return document.querySelectorAll('nav > button')[1] as HTMLElement;
}
```

Then add a new describe block at the end of the file:

```ts
describe('useInspector — semantic', () => {
  it('semantic=false copies the one-line default', async () => {
    const el = stamped();
    renderHook(() => useInspector({ semantic: false }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(copyText).toHaveBeenCalledWith('Foo — src/Foo.tsx:3:1');
  });

  it('semantic=true copies the multi-line block', async () => {
    const el = navTree();
    renderHook(() => useInspector({ semantic: true }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(copyText).toHaveBeenCalledWith(
      'NavItem — src/Sidebar.tsx:93:15\ntext: "Рубрики"\nindex: 2/2\npath: Sidebar › NavItem\ntestid: nav-rubrics'
    );
  });

  it('passes the SemanticInfo object to a custom formatText when semantic is on', async () => {
    const el = navTree();
    const formatText = vi.fn((t) => `${t.comp}:${t.text}:${t.index}/${t.total}`);
    renderHook(() => useInspector({ semantic: true, formatText }));
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(formatText).toHaveBeenCalledWith(
      expect.objectContaining({ comp: 'NavItem', text: 'Рубрики', index: 2, total: 2 })
    );
    expect(copyText).toHaveBeenCalledWith('NavItem:Рубрики:2/2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/useInspector.test.tsx`
Expected: FAIL — `semantic=true` test gets `'NavItem — src/Sidebar.tsx:93:15'` (the current one-line default), not the block.

- [ ] **Step 3: Implement the wiring in `src/useInspector.ts`**

Add imports at the top:

```ts
import { extractSemantics } from './extractSemantics';
import type { CopyKind, InspectTarget, LocInfo, SemanticInfo, SemanticInspectorProps, UseInspectorResult } from './types';
```

(Extend the existing `./types` import with `SemanticInfo` rather than adding a duplicate import line.)

Replace the `defaultFormat` function with both formatters plus a label helper:

```ts
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
  if (t.index && t.total) lines.push(`index: ${t.index}/${t.total}`);
  if (t.path?.length) lines.push(`path: ${t.path.join(' › ')}`);
  if (t.attrs) {
    for (const [k, v] of Object.entries(t.attrs)) lines.push(`${attrLabel(k)}: ${v}`);
  }
  return lines.join('\n');
}
```

In `onClick`, change the destructure and the text-copy branch. Replace:

```ts
      const { formatText = defaultFormat, onCopy, onError } = cbRef.current;
```

with:

```ts
      const { formatText, onCopy, onError, semantic = false } = cbRef.current;
```

and replace the `else` (text-copy) branch:

```ts
      } else {
        const text = formatText({ comp: t.comp, loc: t.loc });
        copyText(text).then(
          () => done('text', text),
          (err: unknown) => fail('text', err)
        );
      }
```

with:

```ts
      } else {
        const info: SemanticInfo = semantic ? extractSemantics(t.el) : { comp: t.comp, loc: t.loc };
        const fmt: (i: SemanticInfo) => string = formatText ?? (semantic ? semanticFormat : defaultFormat);
        const text = fmt(info);
        copyText(text).then(
          () => done('text', text),
          (err: unknown) => fail('text', err)
        );
      }
```

(`defaultFormat` typed `(t: LocInfo) => string` is assignable to `(i: SemanticInfo) => string` because `SemanticInfo extends LocInfo`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/useInspector.test.tsx`
Expected: PASS — all hotkey/click tests plus the three new semantic tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/useInspector.ts src/useInspector.test.tsx
git commit -m "feat(inspector): copy semantic block when semantic prop is set"
```

---

### Task 5: Forward `semantic` from `SemanticInspector`

**Files:**
- Modify: `src/SemanticInspector.tsx`
- Test: `src/SemanticInspector.test.tsx`

`SemanticInspector` forwards an explicit subset of props to `useInspector` (it does not spread), so `semantic` must be added by hand.

- [ ] **Step 1: Write the failing test**

In `src/SemanticInspector.test.tsx`, add a `navTree` helper near `stamped`:

```ts
function navTree(): HTMLElement {
  document.body.innerHTML =
    `<nav data-comp="Sidebar" data-loc="src/Sidebar.tsx:1:1"><button data-comp="NavItem" data-loc="src/Sidebar.tsx:90:5" data-testid="nav-stories">Сюжеты</button><button data-comp="NavItem" data-loc="src/Sidebar.tsx:93:15" data-testid="nav-rubrics">Рубрики</button></nav>`;
  return document.querySelectorAll('nav > button')[1] as HTMLElement;
}
```

Add this test inside the `describe('SemanticInspector', ...)` block:

```ts
  it('forwards the semantic prop so the copied text is the multi-line block', async () => {
    const el = navTree();
    render(<SemanticInspector semantic />);
    act(() => press(HOTKEY));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(el);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    });
    expect(copyText).toHaveBeenCalledWith(
      'NavItem — src/Sidebar.tsx:93:15\ntext: "Рубрики"\nindex: 2/2\npath: Sidebar › NavItem\ntestid: nav-rubrics'
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/SemanticInspector.test.tsx`
Expected: FAIL — `copyText` is called with the one-line default (`semantic` not forwarded).

- [ ] **Step 3: Forward the prop in `src/SemanticInspector.tsx`**

In the `useInspector({ ... })` call, add `semantic` alongside `hotkey` and `formatText`:

```ts
  const { active, target } = useInspector({
    hotkey: props.hotkey,
    semantic: props.semantic,
    formatText: props.formatText,
    onCopy: (kind: CopyKind, payload: string) => {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/SemanticInspector.test.tsx`
Expected: PASS — all existing tests plus the forwarding test.

- [ ] **Step 5: Commit**

```bash
git add src/SemanticInspector.tsx src/SemanticInspector.test.tsx
git commit -m "feat(inspector): forward semantic prop through SemanticInspector"
```

---

### Task 6: Changeset + README

**Files:**
- Create: `.changeset/semantic-payload.md`
- Modify: `README.md`

- [ ] **Step 1: Create the changeset**

Create `.changeset/semantic-payload.md`:

```md
---
"semantic-inspector": minor
---

Add an opt-in `semantic` prop. When enabled, clicking an element copies a multi-line block with
its visible text label, sibling index (N of M among same tag + `data-comp`), `data-comp` component
path, and key attributes (`id`, `data-testid`, `name`, `href`, `type`) in addition to
`Component — file:line:col`. Default output and the hover overlay are unchanged; signals are
computed at click time only. A custom `formatText` now receives the richer `SemanticInfo` object.
```

- [ ] **Step 2: Document the prop in `README.md`**

Insert this section immediately before the `## Three entry points` heading:

````md
## Semantic payload (opt-in)

By default a click copies one line: `Component — file:line:col`. Pass `semantic` to copy a
self-describing block instead — handy so an AI knows *which* element you meant without extra
explanation:

```tsx
<SemanticInspector semantic />
```

Clicking the "Рубрики" item then copies:

```
NavItem — src/components/Navigation/Sidebar.tsx:93:15
text: "Рубрики"
index: 2/5
path: App › Sidebar › NavItem
testid: nav-rubrics
```

Fields are added only when meaningful (e.g. `index` is dropped for a lone element). The visible
text is whitespace-collapsed and capped at 160 chars; the component path keeps the 4 nearest
`data-comp` ancestors; attributes are limited to `id`, `data-testid`, `name`, `href`, `type`.
Everything is read at click time, so hover stays cheap and the overlay tip is unchanged. A custom
`formatText` receives the full `SemanticInfo` object when `semantic` is on.
````

- [ ] **Step 3: Verify the build artifacts of the docs change**

Run: `npm run lint`
Expected: PASS (Biome has no complaint about the new files).

- [ ] **Step 4: Commit**

```bash
git add .changeset/semantic-payload.md README.md
git commit -m "docs: document the opt-in semantic prop"
```

---

### Task 7: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full PR check**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: All PASS. `npm test` runs every `src/**/*.test.{ts,tsx}` including the new `extractSemantics` suite; coverage thresholds (lines/functions/statements 80, branches 70) hold because the new module is fully exercised.

- [ ] **Step 2: Sanity-check coverage of the new module**

Run: `npm run test:cov`
Expected: `src/extractSemantics.ts` reports high coverage (all branches in `extractText`, `siblingIndex`, `componentPath`, `pickAttrs` are hit by the Task 3 tests).

---

## Self-review notes

- **Spec coverage:** clipboard-only enrichment (Task 4/5), signals text/index/attrs/path (Task 3), multi-line format with short labels (Task 4 `semanticFormat`), index basis tag+data-comp (Task 3 `siblingIndex`), opt-in prop default false (Task 1/4/5), caps text 160 / path 4 (Task 3 constants). All covered.
- **Excluded by spec:** ARIA, per-field toggle, overlay/screenshot changes, DOM-tag path — none introduced.
- **Type consistency:** `SemanticInfo`, `extractSemantics`, `resolveComp`, `semanticFormat`, `attrLabel` names match across tasks; `formatText: (t: SemanticInfo) => string` used in Tasks 1 and 4.
- **No placeholders:** every code step shows full code; every test step shows assertions.
