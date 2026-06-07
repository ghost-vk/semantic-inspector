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
