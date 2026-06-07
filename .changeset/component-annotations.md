---
"semantic-inspector": minor
---

Add an opt-in `annotate` mode. A dedicated hotkey (default `Alt+Shift+A`) enters annotate mode; in
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
