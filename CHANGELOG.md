# Changelog

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
