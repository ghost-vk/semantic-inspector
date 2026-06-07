# Component Annotations — Design Spec

**Date:** 2026-06-07
**Status:** Approved (brainstorming)
**Feature branch:** `feat/annotations`

## Problem

The inspector copies a precise pointer to an element (`Component — file:line:col`, optionally a
richer semantic block). That tells an AI *where* an element is **right now**, but it does not give
the element a **durable, human-chosen name**. When a user later says "fix the пилюля," the AI has no
stored mapping from that word to the element — they are speaking different languages. And anything
keyed on `file:line:col` goes stale the moment the AI refactors the code: the line moves, the
pointer rots.

We want a workflow where a user, once, names an element in the inspector ("пилюля"), and from then
on **both the human and the AI** can refer to it by that name without re-inspecting — and the
mapping survives ordinary refactors. The named elements should also be consumable as a knowledge
graph (e.g. for Graphify).

## Goals

- Let a user attach a **name** (+ optional **tags** and a free-text **note**) to any inspected
  element, from inside the inspector.
- Persist annotations into a **repo file** the AI can read directly (not browser-only storage).
- Anchor each annotation to a **durable descriptor**, not a line number, so it resolves correctly
  after refactors.
- Produce a human/Graphify-readable mirror of the annotations.
- Add **zero production runtime cost** and **zero source-code mutation** — consistent with the
  existing dev-only design.

## Non-Goals (YAGNI)

- No CLI / runtime "resolver" tool. Resolution is a documented convention (read the file + grep).
  The file is self-describing; the AI does the lookup.
- No source-code mutation (no injected `data-sem-id`, no rewritten `data-testid`). Anchor is a
  read-only snapshot of what is already there.
- No annotation deletion UI in this version. Editing = re-annotating the same name (upsert).
  Removing an annotation = delete the entry from the JSON by hand.
- No browser-side listing/prefill in this version. The endpoint is **POST-only**; the editor opens
  empty. The consumption path is the AI reading the repo file directly — the browser never needs to
  read annotations back. (A GET/listing API and "already named X" prefill are a possible follow-up;
  they require fuzzy-matching a clicked element to a stored annotation, which is deferred.)
- No new runtime dependency. The package is intentionally zero-runtime-dep; server-side validation
  is hand-rolled (narrow `unknown`, length caps), not Zod.
- No auth / multi-user concerns. This is a local dev server only.

## Key Decisions (from brainstorming)

1. **Anchor strategy: fuzzy descriptor, no source mutation.** Store a snapshot of the element's
   durable signals (`extractSemantics` output) and resolve by grepping them in live code. Line/file
   is kept only as a non-authoritative "last seen" hint.
2. **Write path: dev-server endpoint auto-writes.** The Vite plugin adds a `configureServer`
   middleware; the browser POSTs the annotation and the server writes the repo file. No manual
   paste step.
3. **Format: JSON source of truth + `.md` mirror.** JSON is parsed/merged reliably on upsert; the
   server regenerates a Markdown mirror for humans and Graphify.
4. **Capture gesture: a dedicated hotkey toggles an "annotate mode."** In annotate mode, hover
   highlights (reusing the existing overlay) and a click opens an inline editor instead of copying.
   Default annotate hotkey: `Alt+Shift+A`. The existing inspect-mode gestures (click = copy,
   Shift+click = screenshot) are untouched.

## Architecture Overview

```
                       browser (dev only)                          node (dev server)
  ┌─────────────────────────────────────────────┐      ┌──────────────────────────────────┐
  │ useInspector (annotate mode)                 │      │ stampLocVite.configureServer       │
  │   hover → Overlay highlight                  │      │   POST /__semantic_inspector/...   │
  │   click → open <AnnotationEditor/>           │      │                                    │
  │   submit → buildAnnotation(el,name,tags,note)│      │                                    │
  │            (reuse extractSemantics)          │      │                                    │
  │          → annotationClient.save() ──────────┼─POST─┼─→ validate → annotationStore       │
  │                                              │      │      read JSON → upsert by name    │
  │                                              │      │      stamp time → write JSON        │
  │                                              │      │      regenerate .md mirror         │
  └─────────────────────────────────────────────┘      └──────────────────────────────────┘
                                                                       │ writes
                                                       .semantic-inspector/annotations.json (source)
                                                       .semantic-inspector/annotations.md   (mirror)
```

The browser side computes the annotation payload (anchor descriptor) using the existing
`extractSemantics`. It never writes files; it only talks HTTP to the dev server. The node side owns
all filesystem access and is the only place a path is constructed.

## Data Model

Annotations are keyed by `name` (unique → upsert by name). Types live in `src/types.ts` alongside
the existing `SemanticInfo`.

```ts
/** Durable signals describing an annotated element, used to re-find it after refactors. */
export interface AnnotationAnchor {
  /** Component name (data-comp / fiber / filename / tag). */
  comp: string;
  /** data-comp ancestor chain root→leaf, deduped, max 4 (from extractSemantics). */
  path?: string[];
  /** Visible label, whitespace-collapsed, capped at 160 (from extractSemantics). */
  text?: string;
  /** 1-based index among same-tag + same-data-comp siblings. */
  index?: number;
  /** Count of those siblings. */
  total?: number;
  /** Whitelisted stable attributes present: id, data-testid, name, href, type. */
  attrs?: Record<string, string>;
}

/** A non-authoritative pointer to where the element was last seen. May be stale. */
export interface AnnotationLastSeen {
  /** Relative file path (without line/col), or null when unstamped. */
  file: string | null;
  /** "<path>:<line>:<col>" snapshot, or null when unstamped. Hint only — verify before trusting. */
  loc: string | null;
}

/** One named annotation. */
export interface Annotation {
  /** Human-chosen name, primary key, e.g. "пилюля". */
  name: string;
  /** Optional grouping tags. */
  tags?: string[];
  /** Optional free-text note. */
  note?: string;
  /** Authoritative descriptor for resolution. */
  anchor: AnnotationAnchor;
  /** Non-authoritative last-known location. */
  lastSeen: AnnotationLastSeen;
  /** ISO timestamps, stamped server-side. */
  createdAt: string;
  updatedAt: string;
}

/** On-disk shape of annotations.json. */
export interface AnnotationFile {
  version: 1;
  annotations: Record<string, Annotation>;
}

/** Payload the browser POSTs (server adds timestamps + persists). */
export interface AnnotationInput {
  name: string;
  tags?: string[];
  note?: string;
  anchor: AnnotationAnchor;
  lastSeen: AnnotationLastSeen;
}
```

### Example `annotations.json`

```json
{
  "version": 1,
  "annotations": {
    "пилюля": {
      "name": "пилюля",
      "tags": ["nav"],
      "note": "главная кнопка раздела",
      "anchor": {
        "comp": "NavItem",
        "path": ["App", "Sidebar", "NavItem"],
        "text": "Рубрики",
        "index": 2,
        "total": 5,
        "attrs": { "data-testid": "nav-rubrics", "href": "/rubrics" }
      },
      "lastSeen": {
        "file": "src/components/Navigation/Sidebar.tsx",
        "loc": "src/components/Navigation/Sidebar.tsx:93:15"
      },
      "createdAt": "2026-06-07T12:00:00.000Z",
      "updatedAt": "2026-06-07T12:00:00.000Z"
    }
  }
}
```

### Example `annotations.md` (mirror, regenerated on every write)

```markdown
# Semantic annotations

> Generated by semantic-inspector. Source of truth: annotations.json. Do not edit by hand.

## пилюля

- **tags:** nav
- **component:** NavItem (App › Sidebar › NavItem)
- **text:** "Рубрики"
- **testid:** nav-rubrics
- **href:** /rubrics
- **last seen:** src/components/Navigation/Sidebar.tsx:93:15 _(hint — may be stale, verify)_
- **note:** главная кнопка раздела
```

## Resolution Convention (how an AI finds "пилюля")

Documented in the README; no code ships for it. Given a name:

1. Read `.semantic-inspector/annotations.json` (or the `.md` mirror).
2. Find the entry by `name`.
3. Resolve to live code by grepping in **decreasing order of stability**:
   1. `anchor.attrs["data-testid"]` → grep `data-testid="<value>"` (purpose-built, most stable).
   2. `anchor.attrs.id` / `name` / `href` → grep.
   3. `anchor.text` + `anchor.comp` → grep the visible text near a `data-comp="<comp>"`.
4. Use `lastSeen.loc` only as a first place to look — never as ground truth (it may be stale).
5. Confirm with `anchor.path` (ancestor containment) when multiple candidates match.

## Components / File Structure

Each module is small and single-purpose, matching the existing codebase style.

| File | Responsibility | Side |
| --- | --- | --- |
| `src/types.ts` (modify) | Add `Annotation*` interfaces above. | — |
| `src/annotationEndpoint.ts` (new) | Single shared constant `ANNOTATION_ENDPOINT`. Zero deps, so both the browser client and the node middleware import it without crossing tiers. | shared |
| `src/buildAnnotation.ts` (new) | `buildAnnotation(el, name, tags, note): AnnotationInput`. Reuses `extractSemantics` for the anchor; derives `lastSeen` from the `data-loc`. Pure. | browser |
| `src/annotationClient.ts` (new) | `saveAnnotation(endpoint, input): Promise<Annotation>` — thin `fetch` POST wrapper to the dev endpoint. | browser |
| `src/AnnotationEditor.tsx` (new) | Inline form anchored near the element: name (required) + tags (comma-separated) + note. Enter submits, Esc cancels. Opens empty. | browser |
| `src/annotationStore.ts` (new) | `readFile(dir)`, `upsert(file, input, now): AnnotationFile`, `renderMarkdown(file): string`, `writeFiles(dir, file)`. Owns the JSON↔MD logic. Pure functions + thin fs wrapper, testable with a temp dir. | node |
| `src/annotationMiddleware.ts` (new) | Connect-style handler: parse + validate body, call `annotationStore`, respond. Path is constructed only here (from `rootDir`), never from the request. | node |
| `src/vite.ts` (modify) | Add `configureServer` that mounts `annotationMiddleware` under `/__semantic_inspector/annotations`. | node |
| `src/useInspector.ts` (modify) | Replace the boolean `active` with a single mode `'off' \| 'inspect' \| 'annotate'` (the two modes are mutually exclusive — each hotkey selects its mode, Esc → off). In annotate mode, click opens the editor (suppresses copy). Expose editor state in the return value. Keep `active` derivable for back-compat (`active = mode !== 'off'`). | browser |
| `src/SemanticInspector.tsx` (modify) | Forward new props; render `<AnnotationEditor/>` when the hook signals an open editor. | browser |
| `src/index.ts` (modify) | Re-export new public types. | — |
| `README.md` (modify) | Document annotate mode, the file format, the resolution convention, and a PII/secret caveat. | — |
| `.changeset/*.md` (new) | `minor` changeset. | — |

### New public props (`SemanticInspectorProps`)

```ts
/** Enable annotate mode. Default false (no annotate hotkey, no editor, no network). */
annotate?: boolean;
/** Hotkey that toggles annotate mode. Default 'Alt+Shift+A'. */
annotateHotkey?: string;
/** Override the endpoint base path. Default '/__semantic_inspector/annotations'. */
annotateEndpoint?: string;
/** Called after a successful save (e.g. for a toast). */
onAnnotate?: (annotation: Annotation) => void;
```

`annotate` defaults off, so the feature is fully opt-in and the default bundle/behavior is
unchanged.

## Server Endpoint & Security

Mounted via `configureServer` in `stampLocVite`, which already uses `apply: 'serve'`. Because
`configureServer` only runs on the dev server, the endpoint never exists in a production build.

- **POST** `/__semantic_inspector/annotations` — body is an `AnnotationInput`. Server validates,
  upserts by name, stamps `createdAt`/`updatedAt` (server clock — client timestamps are ignored),
  writes `annotations.json`, regenerates `annotations.md`, returns `200` with the saved
  `Annotation`. Bad input → `400`. Only POST is handled; other methods fall through.

**Security boundary (must hold):**

- The output path is `resolve(rootDir, '.semantic-inspector', 'annotations.json')` and the sibling
  `.md`. The path is **constructed entirely on the server from `rootDir`** — no path, filename, or
  directory component is ever taken from the request body or query. This removes the path-traversal
  vector by construction.
- Request body is validated by hand: `name` must be a non-empty string (length cap, e.g. 200);
  `tags` an array of short strings (caps on count/length); `note` a capped string; `anchor`/
  `lastSeen` shapes checked field by field; unknown fields dropped. Reject oversized bodies.
- Only the two methods above are handled; everything else falls through to the next middleware.
- This writes to the consuming project's working tree — documented clearly, and gated behind the
  opt-in `annotate` prop plus dev-only mounting. The directory is created if missing.

## Error Handling

- **Browser:** `annotationClient` rejects on non-2xx or network error. To avoid overloading the
  copy-oriented `CopyKind` union, annotate has its **own** failure channel rather than reusing
  `onError`: the editor shows an inline error and stays open so the user can retry, and a
  `console.warn` is emitted as the dev-tool fallback. (`onAnnotate` fires only on success.)
- **Server:** validation failure → `400` with a short JSON message. Filesystem failure → `500`
  with a short message (logged via `server.config.logger`). A malformed existing JSON file is
  treated as a hard error (return `500`, do not silently overwrite the user's file).
- **Markdown regeneration** is derived purely from the JSON; if rendering throws, the JSON write
  still succeeds and the error is logged (the source of truth is never left inconsistent).

## Graphify Mapping

The `.md` mirror is the Graphify input. Mapping:

- **Node** per annotation: id = `name`; properties = `tags`, `note`, `comp`, `text`.
- **Edges:** component-path containment from `anchor.path` (e.g. `App → Sidebar → NavItem`) gives a
  natural hierarchy; shared `tags` give grouping edges.

No special export code — the mirror's structure (one `##` section per annotation, labeled fields)
is regular enough for Graphify to ingest as-is.

## Testing Strategy

Vitest + happy-dom, existing thresholds (lines/functions/statements 80, branches 70).

- `annotationStore.test.ts` — upsert creates/updates by name; timestamps preserved on update
  (`createdAt` kept, `updatedAt` changed); markdown rendering (fields present/omitted, escaping);
  read of missing/empty file; malformed JSON throws. Use a temp dir.
- `buildAnnotation.test.ts` — Element → `AnnotationInput`; anchor matches `extractSemantics`;
  `lastSeen` derived from `data-loc`; unstamped element → null file/loc.
- `annotationClient.test.ts` — POST shape, resolves on 200, rejects on non-2xx (mock `fetch`).
- `AnnotationEditor.test.tsx` — renders fields; Enter submits parsed tags; empty name blocks submit;
  Esc cancels.
- `annotationMiddleware.test.ts` — valid POST upserts + responds 200; invalid body → 400;
  path is independent of body (traversal attempt in `name` does not escape the directory);
  non-POST falls through.
- `useInspector.test.tsx` — annotate hotkey toggles annotate mode; click in annotate mode opens the
  editor and does **not** copy; inspect-mode gestures unchanged.

## Backward Compatibility

- `annotate` defaults `false`: no extra hotkey, no editor, no network, no behavior change.
- `AnnotationAnchor` reuses the `extractSemantics` shape; no change to existing copy/semantic paths.
- New props are additive and optional; `formatText`/`semantic`/copy/screenshot all unchanged.
