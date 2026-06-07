# Semantic payload (opt-in) — design

Date: 2026-06-07
Status: approved (pending spec review)

## Problem

Today the inspector copies a single line: `Component — file:line:col`
(e.g. `Sidebar — src/components/Navigation/Sidebar.tsx:93:15`).

That identifies the source location but loses the element's *semantic identity*:
which element it is (the visible label "Рубрики"), which one of a repeated set
(2nd of 5 nav items), and stable anchors (`data-testid`, `id`, `href`). The user
then has to tell the AI separately "I selected the Рубрики tab". We want the
copied text to be self-describing so that extra step disappears.

## Goal

Enrich the **clipboard text payload** with semantic signals about the clicked
element. Opt-in via a prop; default output unchanged. The on-screen overlay tip
and the Shift+click screenshot path are **not** affected.

## Decisions (from brainstorming)

- Enrichment target: **clipboard text only**. Overlay tip stays `comp — loc`.
- Signals captured: **visible text label**, **sibling index (N of M)**,
  **key attributes** (whitelist), **component path** (data-comp ancestor chain).
  Explicitly excluded: ARIA role/accessible-name/state.
- Payload format: **multi-line `key: value` block**. First line stays
  `comp — loc`. Empty fields are omitted.
- Sibling index basis: among the parent's **direct children**, count those with
  the **same `tagName` AND same `data-comp`** as the target.
- Activation: **opt-in via a `semantic` prop** (default `false`). Pre-1.0
  package; no per-field toggle (YAGNI).
- `path` depth cap: **4**. `text` length cap: **160** chars. Block labels: short
  English (`text`, `index`, `path`, `id`, `testid`, `name`, `href`, `type`).

## Public API changes

`src/types.ts`:

```ts
/** Component name + source location resolved for an inspected element. */
export interface LocInfo {
  comp: string;
  loc: string | null;
}

/**
 * LocInfo plus semantic signals about the clicked element. All extra fields are
 * optional and only populated when `semantic` is enabled (and when meaningful —
 * e.g. index/total are omitted for a lone element). Superset of LocInfo, so an
 * existing `formatText: (t) => t.comp` keeps working unchanged.
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

`SemanticInspectorProps`:

```ts
  /** Enrich the copied text with semantic signals (text/index/path/attrs). Default false. */
  semantic?: boolean;
  /**
   * Formats the clipboard text. Receives SemanticInfo; extra fields are populated only
   * when `semantic` is true. Default: `${comp} — ${loc}` (or the multi-line semantic
   * block when `semantic` is true). Backward compatible — LocInfo is a subset.
   */
  formatText?: (t: SemanticInfo) => string;
```

`UseInspectorResult.target` and `InspectTarget` are unchanged — hover/overlay
still use the lightweight `resolveTarget`. Semantics are computed lazily at click
time only.

## New module: `src/extractSemantics.ts`

Pure function `extractSemantics(el: Element): SemanticInfo`. No DOM mutation, no
side effects. Called once per text copy (click), never per mousemove frame.

```ts
import type { SemanticInfo } from './types';
import { resolveComp } from './resolveTarget';

const LOC_ATTR = 'data-loc';
const TEXT_CAP = 160;
const PATH_CAP = 4;
const ATTR_WHITELIST = ['id', 'data-testid', 'name', 'href', 'type'] as const;

export function extractSemantics(el: Element): SemanticInfo {
  const comp = resolveComp(el); // data-comp → fiber name → filename → tag
  const loc = el.getAttribute(LOC_ATTR);
  return {
    comp,
    loc,
    text: extractText(el),
    ...siblingIndex(el),   // { index, total } or {}
    path: componentPath(el),
    attrs: pickAttrs(el),
  };
}
```

Helper behavior:

- **`extractText(el)`**: `el.textContent ?? ''` → collapse runs of whitespace to
  single spaces → trim. If empty, field omitted. If length > 160, slice to 160
  and append `…`. (Uses `textContent`, not `innerText`: deterministic and works
  under jsdom in tests.)
- **`siblingIndex(el)`**: `parent = el.parentElement`; if none → `{}`. Collect
  `parent.children` where `child.tagName === el.tagName` and
  `child.getAttribute('data-comp') === el.getAttribute('data-comp')` (both null
  also counts as equal). Find el's position (1-based). If the matched set size
  <= 1 → `{}`. Else `{ index, total }`.
- **`componentPath(el)`**: walk `el` and ancestors via `parentElement`,
  collecting `data-comp` values; skip nodes without it; collapse consecutive
  duplicates; reverse to root→leaf; cap to last 4 (closest-to-leaf 4). Omit if
  empty.
- **`pickAttrs(el)`**: for each name in the whitelist, if present, add to an
  object. Omit the field entirely if none present.

`comp` fallback: reuse the same resolution as `resolveTarget` (data-comp →
fiber name → filename → tag). To avoid duplication, export a small
`resolveComp(el)` helper from `resolveTarget.ts` and call it from both places.

## Wiring in `src/useInspector.ts`

Two module-level formatters:

```ts
function defaultFormat(t: LocInfo): string {
  return t.loc ? `${t.comp} — ${t.loc}` : t.comp;
}

function semanticFormat(t: SemanticInfo): string {
  const lines = [t.loc ? `${t.comp} — ${t.loc}` : t.comp];
  if (t.text) lines.push(`text: "${t.text}"`);
  if (t.index && t.total) lines.push(`index: ${t.index}/${t.total}`);
  if (t.path?.length) lines.push(`path: ${t.path.join(' › ')}`);
  if (t.attrs) {
    for (const [k, v] of Object.entries(t.attrs)) {
      lines.push(`${attrLabel(k)}: ${v}`); // data-testid → "testid", others as-is
    }
  }
  return lines.join('\n');
}
```

In the click handler, text branch only:

```ts
const { formatText, onCopy, onError, semantic = false } = cbRef.current;
const info = semantic
  ? extractSemantics(t.el)
  : { comp: t.comp, loc: t.loc };
const fmt = formatText ?? (semantic ? semanticFormat : defaultFormat);
const text = fmt(info);
copyText(text).then(/* unchanged */);
```

The Shift+click screenshot branch is untouched.

## Components / boundaries

| Unit | Responsibility | Depends on |
| ---- | -------------- | ---------- |
| `resolveTarget.ts` | hover target + `comp`/`loc` resolution (+ exported `resolveComp`) | DOM |
| `extractSemantics.ts` | clicked element → `SemanticInfo` (pure) | `resolveComp`, DOM read |
| `useInspector.ts` | wiring: pick formatter, call extract on click | both above, clipboard |
| `Overlay.tsx` | unchanged | — |

`extractSemantics` is independently testable: feed a jsdom element, assert the
returned object. No React, no clipboard, no listeners involved.

## Testing

New `src/extractSemantics.test.ts`:

- text: collapses whitespace, trims, truncates at 160 with `…`, omits when empty.
- index/total: 2nd of 5 matching siblings; omitted when total <= 1; mixed tags
  not counted; mixed data-comp not counted.
- path: root→leaf order, consecutive dedup, capped at 4, omitted when no comps.
- attrs: only whitelisted + present keys; omitted when none.
- edges: no `parentElement`; element with neither data-comp nor data-loc.

Extend `src/useInspector.test.tsx`:

- `semantic={false}` (default) copies the existing one-line text.
- `semantic={true}` copies the multi-line block.
- custom `formatText` receives the `SemanticInfo` object when `semantic` is true.

## Docs

- README: document the `semantic` prop with a before/after payload example and
  note it is opt-in / dev-only / click-time cost.
- CHANGELOG: minor bump entry (new opt-in feature, no breaking change).

## Out of scope

- ARIA role / accessible name / state (aria-selected, aria-current).
- Per-field enable/disable configuration.
- Any change to the overlay tip or the screenshot copy path.
- DOM-tag path (component path chosen instead).
