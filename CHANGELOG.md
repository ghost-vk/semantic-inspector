# Changelog

## 0.3.0

### Minor Changes

- 5f7b7d4: Add an opt-in `annotate` mode. A dedicated hotkey (default `Alt+Shift+A`) enters annotate mode; in
  it, clicking an element opens an inline editor to give the element a human name (+ optional tags and
  a note). The annotation is POSTed to a dev-server endpoint added by the Vite plugin and persisted to
  `.semantic-inspector/annotations.json` (source of truth) with a regenerated `annotations.md` mirror.

  Annotations are anchored on a durable descriptor (the same signals as the semantic payload:
  component, visible text, sibling index, component path, and stable attributes like `data-testid`),
  not on `file:line:col`, so a name keeps resolving after refactors. New props: `annotate`,
  `annotateHotkey`, `annotateEndpoint`, `onAnnotate`. Default behavior is unchanged.

  When enabled, saving writes `.semantic-inspector/annotations.json` and `.semantic-inspector/annotations.md`
  into your project root (commit them to share the vocabulary). The endpoint exists only on the dev
  server: its output path is derived solely from `rootDir` (never from the request), it requires
  `Content-Type: application/json` and rejects cross-origin requests (CSRF), and the `.md` mirror
  escapes Markdown and marks its values as untrusted input. See the README "Annotate mode" notes
  before committing annotation files or feeding the mirror to an AI.

- 91e1d3f: Add `semantic-inspector check` CLI: detects drift between `.semantic-inspector/annotations.json` and
  the current source via static Babel analysis. Verdicts (resolved/moved/missing/ambiguous/
  unverifiable), `--json` report for AI agents, `--fix` to relock moved entries, and a non-zero exit to
  gate CI.

  The scan caps per-file size (~2 MB) before parsing so a single huge source file can't drive Babel to
  an out-of-memory crash of the CI gate; files over the cap or that fail to parse are skipped and
  counted. The `--json` report and the human table both surface a `skipped` count so a partial scan is
  never mistaken for an authoritative one. The `--json` schema is now documented in the README.

- 5f7b7d4: Add an opt-in `semantic` prop. When enabled, clicking an element copies a multi-line block with
  its visible text label, sibling index (N of M among same tag + `data-comp`), `data-comp` component
  path, and key attributes (`id`, `data-testid`, `name`, `href`, `type`) in addition to
  `Component — file:line:col`. Default output and the hover overlay are unchanged; signals are
  computed at click time only. A custom `formatText` now receives the richer `SemanticInfo` object.
- Add `applyOnBuild` option to `stampLocVite`. By default the Vite plugin only stamps `data-loc`/`data-comp` during `vite dev` (`apply: 'serve'`), so `vite build` produces unstamped bundles and the inspector tooltip showed `S · no source` on staging / dev-stand builds. Pass `applyOnBuild: true` to also stamp during `vite build` — source file paths are embedded in the bundle, so it is opt-in only and should be left off for publicly shipped production builds.

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/). It is pre-1.0, so the public surface may change in
minor releases. Stable exports: `SemanticInspector`, `useInspector`, the public types, and the
`stampLocVite` / `stampLocBabel` plugin entries.

## 0.2.0

### Breaking

- **`./babel` is now a named export.** Use `import { stampLocBabel } from 'semantic-inspector/babel'`
  instead of a default import. Fixes a CJS/ESM interop hazard where the published `.d.cts`
  advertised a `default` that did not exist at runtime.
- **Root barrel no longer re-exports internals** (`resolveTarget`, `copyText`, `copyElementShot`).
  Only `SemanticInspector`, `useInspector`, and the public types are part of the API.
- **`@babel/core` moved to optional `peerDependencies`.** Consumers of `semantic-inspector/vite`
  or `semantic-inspector/babel` must install it: `npm i -D @babel/core`. Pure-runtime consumers
  no longer pull ~11 MB of Babel into `node_modules`.
- **`engines.node` floor raised to `>=20`** (Node 18 is end-of-life).
- **`data-loc` now includes a column** (`path:line:col`). Only affects code that parses the attribute.

### Fixed

- `modern-screenshot` is now lazy-loaded inside `copyElementShot`, so it is emitted as a separate
  chunk and never lands in a consumer's production bundle through the runtime entry.
- `mousemove` is rAF-coalesced with same-element/same-rect change detection — no more re-render per
  event (removes dev-time jank on high-refresh displays).
- Toast timer is cleaned up on unmount (no state update after unmount).
- Hotkey matching normalizes `event.code` generically, so shifted-symbol and digit hotkeys work
  (e.g. `Ctrl+Shift+/`); a literal `+` key is supported.
- Click now copies exactly the highlighted element (reuses the hovered target instead of
  re-hit-testing), avoiding a wrong-element copy after a layout shift.
- Screenshot capture is guarded against overlapping Shift+clicks and rasterizes at `scale: 1`.
- Copy failures surface via `console.warn` when no `onError` handler is provided.
- `data-loc` paths use `node:path` and degrade to a basename for files outside `rootDir` —
  an absolute filesystem path can no longer leak into the DOM (also fixes Windows separators).
- The Vite plugin runs only on the dev server (`apply: 'serve'`) and skips non-JSX files.

### Changed

- All public JSDoc translated to English (ships in `dist/*.d.ts` IntelliSense).
- Babel plugin uses the real Babel `ConfigAPI` signature and calls `api.assertVersion(7)`.
- Build: explicit tsup `target: es2021`; `isolatedDeclarations` enabled.
- Tooling: Biome lint, Vitest coverage gate, `publint` + `@arethetypeswrong/cli` package
  validation, dist smoke test, Changesets, and Dependabot added.
- CI hardened (least-privilege permissions, concurrency, split jobs, Node 20/22/24 matrix,
  SHA-pinned actions); publishing moved to npm OIDC Trusted Publishing.

## 0.1.0

- Initial release.
