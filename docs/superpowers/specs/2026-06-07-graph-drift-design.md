# Graph Drift Detection — Design Spec

**Date:** 2026-06-07
**Status:** Approved (brainstorming)
**Feature branch:** `feat/graph-drift`

## Problem

The annotate feature persists a knowledge graph of named elements into
`.semantic-inspector/annotations.json` (+ a Graphify-readable `.md` mirror). Each annotation
anchors an element on a **durable descriptor** (`comp`, `path`, `text`, `index`/`total`, `attrs`)
plus a non-authoritative `lastSeen` location (`file:line:col`). The descriptor is designed to
survive refactors — but nothing **tells anyone when it has stopped resolving**. When code changes
under an annotation (element renamed, moved, deleted, its `data-testid` changed), the graph silently
rots. The human and the AI keep referring to "пилюля," but the mapping is now stale, and no one
notices until a lookup fails.

We want a tool that, given the existing `annotations.json` and the current source tree, reports
which annotations still resolve and which have **drifted** — so the drift can be caught in CI
(blocking a merge until the graph is updated) and so an AI agent can read a structured report and
**re-anchor the drifted entries**, keeping the graph in sync with the codebase.

This intentionally builds the "CLI resolver" that the
[component-annotations spec](2026-06-07-component-annotations-design.md) listed as a Non-Goal
("resolution is a documented convention"). That convention — grep `data-testid` → `id`/`href` →
`text` + `comp` — is exactly what this tool **automates and verifies**.

## Goals

- Ship a standalone CLI (`semantic-inspector check`) that compares `annotations.json` against the
  current source tree and reports a per-annotation **drift verdict**.
- Make it **CI-native**: a non-zero exit on drift so a pipeline can block an MR; no browser, no
  running app, no build step required.
- Emit a **machine-readable report** (`--json`) an AI agent consumes to re-anchor drifted entries
  (the stated purpose: let the agent update the graph).
- **Auto-fix the safe cases** (`--fix`): when an anchor still resolves uniquely at a new location,
  relock its stale `lastSeen.loc` in place; leave the hard cases (missing/ambiguous) for the agent.
- Reuse the shipped Babel infrastructure (`stampLocBabel`) so static resolution stays faithful to
  how `data-loc`/`data-comp` are produced.

## Non-Goals (YAGNI)

- **No runtime/DOM drift checking.** No headless browser, no app render, no re-running
  `extractSemantics` against a live DOM. v1 is static-source only. (Runtime checking is more
  accurate for dynamic `text`/`attrs` but is heavy and not CI-lightweight — deferred.)
- **No baseline fingerprint / lockfile.** We re-resolve the anchor from source each run rather than
  storing a hash at annotate time. No data-model change, no capture↔check coupling. (A fingerprint
  fast-path is a possible v2 optimization.)
- **No auto-fix of hard drifts.** `--fix` only relocks `moved` (and fills a null `loc` on a unique
  match). `missing`/`ambiguous` are never rewritten automatically — re-anchoring those needs the
  AI/human, because the anchor itself must change.
- **No new annotation schema.** `annotations.json` is read as-is; `--fix` touches only `lastSeen`
  and `updatedAt`. No migration.
- **No new runtime dependency for browser consumers.** `@babel/core` stays an *optional peer* (it
  already is, for the stamp); the CLI runtime-checks for it. Browser-only consumers never need it.
- **No network, no telemetry.** The CLI reads source + `annotations.json` and writes only
  `annotations.json`/`.md`.

## Key Decisions (from brainstorming)

1. **Drift depth: re-resolve the anchor in source (static).** Automate the documented grep
   convention via AST. Verdicts: `resolved` / `moved` / `missing` / `ambiguous` / `unverifiable`.
   File-existence is the cheap first tier inside this (a missing file yields `missing`).
2. **Write posture: read-only default, `--fix` for safe relocks.** The tool never mutates unless
   `--fix` is passed, and even then only updates an unambiguous `moved` entry's `lastSeen`.
3. **Output: human table + non-zero exit; `--json` structured report.** Human-readable by default
   for CI logs; `--json` for the agent.
4. **Engine: Babel AST.** The only approach that recovers `comp`/`path` from source — source has no
   `data-comp` (it is stamped at build), so text-grep alone cannot identify the component. Reuses
   `nearestComponentName` from `stampLocBabel`.

## Why static resolution is the right depth (and its honest limits)

`data-loc="<relpath>:<line>:<col>"` and `data-comp="<Component>"` are stamped onto JSX **host**
elements at build by [`stampLocBabel`](../../../src/stampLocBabel.ts). So:

- **Statically recoverable from source:** `comp` (`nearestComponentName`), `loc` (`node.loc`),
  `path` (ancestor component chain), and any **string-literal** attrs/text.
- **Runtime-only (not reliably in source):** `text` when it is `{interpolated}`, `attrs` values that
  are expressions (`href={url}`), and `index`/`total` (live sibling counts).

The tool scores only the signals it can compare and **never penalizes** a signal that is dynamic in
source. When an anchor has *no* statically-comparable identity signal, the verdict is
`unverifiable` (honest, not a false pass) and the report suggests adding a `data-testid`.

## Architecture Overview

```
annotations.json ─┐
                  ├─ driftCheck ─ resolveAnchor (per entry, pure) ─→ DriftResult ─┬─ driftReport (human | --json)
source files ─ staticAnchors ──┘                                                  └─ driftFix (--fix → writeAnnotations)
   (collectSourceFiles)

cli.ts: parseArgs → driftCheck → driftReport → (driftFix) → process.exit(code)
```

The whole pipeline is **node-only** and reached exclusively through the `bin`, never through the
browser entry `src/index.ts` — so `node:fs`/`@babel/core` never leak into a consumer's browser
bundle (same discipline as `annotationStore.ts`, which is imported only from `src/vite.ts`).
`resolveAnchor` and `driftReport` are **pure** (no fs, no babel) and hold the core logic, so they
unit-test without temp dirs or fixtures-on-disk.

## Components / File Structure

| File | Responsibility | Side |
| --- | --- | --- |
| `src/staticAnchors.ts` (new) | `staticAnchors(file, source): StaticElement[]` — `parseSync` the file, walk JSX host elements, emit the static analog of `extractSemantics` (loc, comp, path, literal text, literal whitelisted attrs). Returns `[]` for files with no JSX. | node |
| `src/collectSourceFiles.ts` (new) | `collectSourceFiles(root, include?): string[]` — recursively walk `root`, include `.jsx/.tsx/.js/.ts` (skip `*.test.*` and `*.d.ts`), exclude `node_modules`/`dist`/`.semantic-inspector` and dotdirs; optional `include` = path-prefix filters (dependency-free, no glob lib). | node |
| `src/resolveAnchor.ts` (new) | `resolveAnchor(anchor, lastSeen, candidates): DriftEntry` — pure scoring + ranking by stability order → verdict, `resolvedLoc`, ranked candidates. | pure |
| `src/driftCheck.ts` (new) | Orchestrate: `readAnnotations` → `collectSourceFiles` → `staticAnchors` (all files) → `resolveAnchor` per annotation → `DriftResult`. | node |
| `src/driftReport.ts` (new) | `formatHuman(result): string`, `formatJson(result): string`. Pure. | pure |
| `src/driftFix.ts` (new) | Relock `moved` entries (and fill a null `loc` on a unique match) → update `lastSeen` + `updatedAt`, persist via existing `writeAnnotations` (regenerates `.md`). Leaves missing/ambiguous untouched. | node |
| `src/driftCli.ts` (new) | `runCli(argv, now?): Promise<number>` — `node:util` `parseArgs`, wire the pipeline, print, and **return** an exit code (no `process.exit`, so it is unit-testable). | node |
| `src/cli.ts` (new) | Tiny bin shim: shebang + dynamic-import `driftCli` + `process.exit(await runCli(...))`; prints a friendly hint if `@babel/core` is absent. Excluded from coverage. | node |
| `src/stampLocBabel.ts` (modify) | Export `nearestComponentName` (or extract to a shared `componentName.ts`) so `staticAnchors` reuses it instead of duplicating. | node |
| `src/types.ts` (modify) | Add `StaticElement`, `DriftVerdict`, `DriftEntry`, `DriftResult`. | — |
| `package.json` (modify) | Add `"bin": { "semantic-inspector": "./dist/cli.js" }`. | — |
| `tsup.config.ts` (modify) | Add `src/cli.ts` entry; esbuild preserves the entry shebang; `@babel/core` already external. | — |
| `README.md` (modify) | New "Drift detection (CI)" section. | — |
| `.changeset/*.md` (new) | `minor` changeset. | — |

`src/index.ts` (browser entry) is **not** modified — the drift tool is node-only and exposes no
browser API.

## Data Model (new types in `src/types.ts`)

```ts
/** A JSX host element as recovered statically from source (AST analog of SemanticInfo). */
export interface StaticElement {
  /** Relative POSIX file path. */
  file: string;
  /** "<relpath>:<line>:<col>" — byte-identical to the stamp format, so it compares to lastSeen.loc. */
  loc: string;
  /** nearestComponentName, or null when no PascalCase component ancestor exists. */
  comp: string | null;
  /** Ancestor component-name chain, root→leaf, consecutive dupes collapsed, max 4. */
  path: string[];
  /** Direct JSXText children, whitespace-collapsed, code-point-capped at 160. Omitted if dynamic-only. */
  text?: string;
  /** Whitelisted attributes whose source value is a string literal: id, data-testid, name, href, type. */
  attrs: Record<string, string>;
}

export type DriftVerdict = 'resolved' | 'moved' | 'missing' | 'ambiguous' | 'unverifiable';

/** One annotation's drift result. */
export interface DriftEntry {
  name: string;
  verdict: DriftVerdict;
  /** lastSeen.loc from the annotation (may be null for an unstamped anchor). */
  lastSeenLoc: string | null;
  /** Where it resolves now: same as lastSeenLoc when `resolved`, the new loc when `moved`, else null. */
  resolvedLoc: string | null;
  /** Ranked match candidates (score desc, loc asc). Surfaced for `ambiguous` and for --json. */
  candidates: { loc: string; score: number }[];
}

export interface DriftResult {
  entries: DriftEntry[];
  /** Count of moved/missing/ambiguous entries (resolved + unverifiable excluded). */
  drifted: number;
  /** Count of `resolved` entries. */
  ok: number;
}
```

## Resolution Algorithm

### Static extraction (`staticAnchors`)

Mirror `extractSemantics`, but from the Babel AST instead of the DOM:

- **comp** — `nearestComponentName(path)` (reused from `stampLocBabel`).
- **loc** — `${toRel(file)}:${node.loc.start.line}:${node.loc.start.column + 1}` — the *same*
  formula the stamp uses, so the string compares equal to a stored `lastSeen.loc`.
- **path** — walk JSX-element ancestors, collect each one's `nearestComponentName`, collapse
  consecutive duplicates, keep the 4 closest to the leaf, present root→leaf.
- **text** — concatenate **direct** `JSXText` children (skip `{expression}` children), collapse
  whitespace, trim, code-point-cap at 160. If the element has only expression children → `text`
  omitted.
- **attrs** — for the whitelist `[id, data-testid, name, href, type]`, include an entry **only when
  the JSX attribute value is a `StringLiteral`** (or a `JSXExpressionContainer` wrapping a string
  literal). Expression values are omitted — they cannot be compared statically.

Only **host** elements (lowercase tag) get a `StaticElement`, matching `isHostElement` in the stamp.
A file that fails to parse is reported up the stack as a warning and contributes no elements (its
anchors will surface as `missing`, which is the honest outcome).

### Matching (`resolveAnchor`, pure)

Inputs: one annotation's `anchor` + `lastSeen`, and **all** `StaticElement`s across scanned files.

**Comparable signal** = a signal present in the anchor AND statically available on the candidate.
Score only comparable signals; a signal that is dynamic in source is simply not scored (never a
penalty). Weights follow the documented stability order:

| signal | weight |
| --- | --- |
| `data-testid` equal | 100 |
| `id` equal | 60 |
| `href` equal | 50 |
| `name` equal | 50 |
| `comp` equal | 20 |
| `text` match (normalized; equal, or one a substring of the other → tolerates interpolation) | 15 |
| `path` containment (anchor.path is an ordered subsequence of candidate.path) | 10 |
| `type` equal | 5 |

**Identity threshold** (prevents matching on weak signals alone): a candidate qualifies only if it
has **≥1 strong id signal** among `{data-testid, id, href, name}` equal, **OR** (`comp` equal AND
`text` match). Candidates below threshold are discarded before ranking.

**Verdict:**

1. Keep candidates that meet the identity threshold; sort by `(score desc, loc asc)` (deterministic).
2. **0 candidates** → `missing`.
3. **Unique top** (top score strictly greater than the 2nd) →
   - `loc === lastSeen.loc` → `resolved` (`resolvedLoc = loc`).
   - else → `moved` (`resolvedLoc =` top candidate's loc).
4. **≥2 candidates tied at the max score** → `ambiguous` (report the tied candidates).
5. **No statically-comparable identity signal** in the anchor (no literal `data-testid`/`id`/`href`/
   `name`, and `text` is dynamic) → `unverifiable` (regardless of candidate count).
6. **`lastSeen.loc === null`** (unstamped anchor): skip the loc comparison in step 3 — a unique
   identity match is `resolved` (and `--fix` fills the loc); 0 → `missing`; tie → `ambiguous`.

### Exit / CI policy

| verdict | default exit | `--fix` behavior |
| --- | --- | --- |
| `resolved` | 0 | — |
| `moved` | **1** | relock `lastSeen.loc`/`file` → becomes `resolved` |
| `missing` | **1** | not auto-fixable — agent re-anchors |
| `ambiguous` | **1** | not auto-fixable — agent/human disambiguates |
| `unverifiable` | 0 (warn) | — (report suggests adding `data-testid`) |

Process exit = `1` if any entry's effective verdict (after `--fix`) is `moved`/`missing`/
`ambiguous`; else `0`. Flags adjust the policy:

- `--allow-moved` — treat `moved` as a warning (exit 0). For teams that relock out-of-band.
- `--strict` — treat `unverifiable` as drift (exit 1). For teams that require every anchor to carry
  a stable signal.
- `--fix` — relock `moved` + null-loc-unique entries, persist via `writeAnnotations`, then exit `1`
  only if `missing`/`ambiguous` remain.

When `--fix` runs, the printed report (human and `--json`) reflects **post-fix** verdicts —
relocked entries appear as `resolved`, so a `--fix --json` run shows the agent exactly what remains
to re-anchor by hand.

Other exit codes: `2` for usage/IO errors (bad args; `annotations.json` malformed — `readAnnotations`
throws on bad shape/version and that is surfaced, never silently overwritten). A **missing**
`annotations.json` is not an error: exit `0` with "no annotations found."

## CLI Surface

`semantic-inspector check [options]` (a bare `semantic-inspector` defaults to `check`).

| flag | effect |
| --- | --- |
| `--fix` | apply safe relocks and persist |
| `--json` | emit the JSON report to stdout instead of the human table |
| `--root <dir>` | project root (default `process.cwd()`); annotations read from `<root>/.semantic-inspector/annotations.json` |
| `--include <prefix>` | restrict the scan to a path prefix under root (repeatable); default scans all `.jsx/.tsx/.js/.ts` |
| `--allow-moved` | `moved` → warning (exit 0) |
| `--strict` | `unverifiable` → drift (exit 1) |
| `--help` / `--version` | usage / version |

Args parsed with **`node:util` `parseArgs`** (built-in on node ≥ 20 — no new dependency).

### Human output (default)

```
semantic-inspector drift — 5 annotations, 2 drifted

  ✓ resolved    пилюля       src/Sidebar.tsx:93:15
  ~ moved       searchBtn    src/Header.tsx:40:7  (was :31:7)   [--fix]
  ✗ missing     oldModal     (was src/Modal.tsx:12:3)
  ? ambiguous   submit       Form.tsx:20:5 · Form.tsx:55:5 · …
  · unverify    avatar       no stable signal — add data-testid

2 drifted (1 fixable). Run with --fix to relock moved entries.
```

Exit code `1` here (a `moved` and a `missing`).

### JSON output (`--json`)

```json
{
  "drifted": 2,
  "ok": 3,
  "entries": [
    {
      "name": "searchBtn",
      "verdict": "moved",
      "lastSeenLoc": "src/Header.tsx:31:7",
      "resolvedLoc": "src/Header.tsx:40:7",
      "candidates": [{ "loc": "src/Header.tsx:40:7", "score": 150 }]
    },
    {
      "name": "oldModal",
      "verdict": "missing",
      "lastSeenLoc": "src/Modal.tsx:12:3",
      "resolvedLoc": null,
      "candidates": []
    }
  ]
}
```

The agent reads `entries` where `verdict != "resolved"`: it uses `resolvedLoc`/`candidates` to
relock or re-anchor, updates `annotations.json` (and the graph), and re-runs `check` to confirm
green.

## Packaging

- `package.json`: `"bin": { "semantic-inspector": "./dist/cli.js" }`. The package is
  `"type": "module"`, so the bin is an ESM file; node ≥ 20 runs an ESM bin with a shebang fine.
  `files` already includes `dist`.
- `@babel/core` remains an **optional peer dependency**. The CLI imports `parseSync`, `traverse`,
  and `types` from `@babel/core` (no separate `@babel/parser`/`@babel/traverse` deps needed) and
  **runtime-checks** its presence at startup: if absent, it prints
  `semantic-inspector check requires @babel/core — npm i -D @babel/core` and exits `2`. This keeps
  browser-only consumers free of Babel while the CLI (a separate entry, tree-shaken out of the
  browser bundle) gets what it needs. Most consumers already have `@babel/core` (the Vite/Babel
  stamp depends on it).
- `tsup.config.ts`: add `src/cli.ts` to entries; esbuild preserves the `#!/usr/bin/env node` shebang
  at the top of the entry file (no banner config needed); `@babel/core` is already external.

## Security

- **Reads** source files + `annotations.json`; **writes** only `annotations.json` and its `.md`
  sibling, via the existing `writeAnnotations` — the path is derived solely from `--root`
  (`resolve(root, '.semantic-inspector', …)`), never from annotation content, and the write is
  atomic (temp file + rename).
- Babel is used **parse-only** (`parseSync`) — source is never transformed or executed — so running
  the CLI over untrusted source cannot run that source.
- Untrusted annotation field values are already Markdown-escaped by `renderMarkdown` when `--fix`
  regenerates the mirror (the existing structural guard; the UNTRUSTED banner is preserved).
- No network access.

## Error Handling

- **Malformed `annotations.json`** → `readAnnotations` throws (bad shape/version); the CLI reports
  it and exits `2`. Never silently overwritten.
- **Unparseable source file** → warn to stderr, skip the file, continue. Anchors that lived there
  surface as `missing` (honest), not a crash.
- **`--fix` write failure** → exit `2` with the error; the atomic write means a half-written
  `annotations.json` is impossible. The `.md` mirror is best-effort (its failure does not fail the
  fix, mirroring `writeAnnotations`).
- **Bad CLI args** → usage message, exit `2`.

## Testing Strategy

Vitest + happy-dom, existing thresholds (lines/functions/statements 80, branches 70).

- `resolveAnchor.test.ts` (pure — the core) — each verdict: `resolved` (loc match), `moved` (loc
  differs), `missing` (no candidate), `ambiguous` (score tie), `unverifiable` (no comparable
  identity signal); identity threshold (comp-only candidate rejected); scoring order (`data-testid`
  outranks `text`); `path` tiebreak; `lastSeen.loc === null` branches.
- `staticAnchors.test.ts` — literal `data-testid`/`text`/`href` extracted; dynamic attr/text
  omitted; `comp`/`path`/`loc` correct and loc matches the stamp format; non-JSX file → `[]`; nested
  components → correct `path`.
- `collectSourceFiles.test.ts` — globbing + excludes (`node_modules`, `dist`, `.semantic-inspector`)
  on a temp tree.
- `driftCheck.test.ts` — temp dir with `annotations.json` + source files → correct `DriftResult`
  counts across verdicts; unparseable file skipped (warned, not fatal).
- `driftFix.test.ts` — temp dir: a `moved` entry is relocked (`lastSeen.loc`/`file` updated,
  `updatedAt` bumped, `createdAt` preserved, `.md` regenerated); `missing`/`ambiguous` untouched.
- `driftReport.test.ts` (pure) — human format per verdict; `--json` shape stable and valid.
- `cli.test.ts` — `parseArgs` wiring → exit codes (drift `1`, clean `0`, `--allow-moved`,
  `--strict`, bad args `2`); `--json` emits valid JSON; `--fix` end-to-end on a temp dir.

## Backward Compatibility

- Purely additive: a new `bin`, new node-only modules, new types. No change to the browser runtime,
  existing props, the copy/screenshot path, or the annotate flow.
- `annotations.json` schema is unchanged. `--fix` updates only `lastSeen` and `updatedAt` on
  `moved`/null-loc entries; it never rewrites `anchor`. No migration, forward/backward compatible
  with files written by the annotate endpoint.

## Documentation

A new README section, **"Drift detection (CI)"**:

- The command, flags, and exit codes.
- A CI snippet: run `semantic-inspector check`; a non-zero exit blocks the MR; the agent reads
  `--json`, re-anchors, relocks (`--fix`), and re-runs to green.
- The static-resolution limits: anchors whose only signals are dynamic in source resolve as
  `unverifiable`; adding a `data-testid` makes an element robustly anchorable (and is the most
  stable signal in the resolution order).
