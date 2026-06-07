# semantic-inspector

A dev-only React inspector for vibe-coding. Hit a hotkey to enter inspect mode:
hovering highlights the element under the cursor and shows its component name +
`file:line`. **Click** copies that text identifier to the clipboard;
**Shift+click** copies a PNG screenshot of just that element. Built for pasting
precise UI context into an AI chat in seconds.

Stack: Vite + `@vitejs/plugin-react` + React 18/19. Zero runtime cost in
production — you gate where it mounts.

## Install

```sh
npm i -D semantic-inspector
```

`react` / `react-dom` are peer deps (>=18). `vite` is an optional peer — only
needed if you use the Vite plugin entry point.

## How it works

Source locations come from a **build-time stamp**, not React internals. A Babel
pass adds `data-loc="<path>:<line>"` and `data-comp="<Component>"` to JSX host
elements (`div`, `section`, …). The runtime reads those DOM attributes, so it
stays robust across React versions. If a node isn't stamped (prod build, foreign
node), it degrades gracefully: fiber `displayName` → filename → tag name.

## Three entry points

| Import                          | What it is                                                              |
| ------------------------------- | ---------------------------------------------------------------------- |
| `semantic-inspector`            | `<SemanticInspector/>` — the overlay + hotkey + clipboard runtime.     |
| `semantic-inspector/vite`       | `stampLocVite()` — Vite plugin that stamps `data-loc` / `data-comp`.   |
| `semantic-inspector/babel`      | Raw Babel plugin, for the babel variant of `@vitejs/plugin-react`.     |

## Usage

### 1. Stamp source locations (Vite plugin)

`@vitejs/plugin-react` **v6** transpiles via oxc (no Babel hook), so stamp with a
separate `pre` plugin:

```ts
import react from '@vitejs/plugin-react';
import { stampLocVite } from 'semantic-inspector/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // stampLocVite first (enforce: 'pre'), then react()
  plugins: [stampLocVite({ rootDir: process.cwd() }), react()]
});
```

`rootDir` is the base for the relative path written into `data-loc`.

On the **Babel variant** of plugin-react you can skip the separate pre-pass:

```ts
import react from '@vitejs/plugin-react';
import stampLoc from 'semantic-inspector/babel';

react({ babel: { plugins: [[stampLoc, { rootDir: process.cwd() }]] } });
```

### 2. Mount it (behind your own dev flag, ideally lazy)

```tsx
import { lazy, Suspense } from 'react';

const SemanticInspector = lazy(() =>
  import('semantic-inspector').then((m) => ({ default: m.SemanticInspector }))
);

{
  import.meta.env.DEV && (
    <Suspense fallback={null}>
      <SemanticInspector onCopy={(kind) => toast(`${kind} copied`)} />
    </Suspense>
  );
}
```

## Props

| prop         | default                  | purpose                                  |
| ------------ | ------------------------ | ---------------------------------------- |
| `hotkey`     | `'Alt+Shift+S'`          | toggle inspect mode (Esc exits)          |
| `formatText` | `` `${comp} — ${loc}` `` | format of the text copied on click       |
| `onCopy`     | —                        | callback after a copy (telemetry/toasts) |
| `onError`    | —                        | callback on clipboard/screenshot failure |

## Notes

- `navigator.clipboard` requires a secure context (localhost / https) and a
  user gesture — that's why copy happens on **click**, not hover.
- Screenshots use `modern-screenshot` (DOM→canvas): cross-origin `<img>` without
  CORS and some exotic CSS may not render.
- On a prod React build without `data-loc`, the name falls back to the fiber
  (minified) or tag — degraded mode. Full mode needs the build-time stamp.

## Development

```sh
npm install
npm test         # vitest
npm run typecheck
npm run build    # tsup -> dist/ (esm + cjs + d.ts)
```

## License

MIT
