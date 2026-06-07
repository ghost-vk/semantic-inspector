# Playground demo app — design

**Status:** approved
**Date:** 2026-06-07
**Branch:** `feat/playground` (off `main`, which already contains annotate mode)

## Problem

`semantic-inspector` ships source + tests, but the only way to actually *use* it — press the hotkeys, hover, click-copy, screenshot, annotate — is to wire it into a separate real project. There is no in-repo way to "feel" how it works. We want a runnable example app inside the repo that exercises inspect, screenshot, and annotate against the live source, with fast iteration (edit `src`, see it immediately) and a CI guard so it can't silently bitrot.

## Goals

- A runnable React + Vite playground in `examples/playground/` started with one command.
- Consumes the package's **live TypeScript source** via Vite aliases — no build, no publish, no link; editing `src/*` hot-reloads in the demo.
- Exercises every inspector signal: component name + `data-loc`, component path, sibling `index/total`, `data-testid`/`href` attributes, multi-language visible text (the "пилюля" cross-language annotate scenario).
- Mounts `<SemanticInspector annotate>` so inspect, screenshot, and annotate all work, including the dev-server annotate endpoint (writes `.semantic-inspector/` into the playground dir).
- A lightweight CI job that typechecks + builds the playground, so a breaking package change fails before merge.

## Non-goals (YAGNI)

- No `react-router` / multi-page app — one representative page.
- No separate `package.json` / `node_modules` for the playground — it reuses root devDeps.
- No Storybook / Ladle component catalog — the user wants a running app, not a catalog.
- No vitest unit tests for the playground (it is glue; see Testing).
- No e2e / Playwright.
- The playground is never published (`files: ["dist"]` already excludes it).

## Decisions (from brainstorming)

1. **Consumption:** live source via Vite alias (instant HMR; does not exercise the built `dist`/exports map — that is already covered by `lint:pkg` + `test:dist`).
2. **Branch base:** new branch off `main` (PR #4 / annotate already merged as `5f7b7d4`).
3. **CI:** a lightweight build-check job (prevents silent bitrot).
4. **Scope:** a single representative page.
5. **Structure:** reuse root devDeps (no second `package.json`).

## Layout

```
examples/playground/
  index.html
  vite.config.ts          # alias src + mount stampLocVite + react()
  tsconfig.json           # extends root config; includes this dir (for the CI typecheck)
  README.md               # how to run + manual test checklist
  src/
    main.tsx              # createRoot → <App/> and the mounted <SemanticInspector annotate …/>
    App.tsx               # page shell + on-page hotkey legend
    components/
      Sidebar.tsx         # nav list rendering repeated <NavItem> (exercises index/total + path)
      NavItem.tsx         # one nav row: data-testid + RU label
      ContentCard.tsx     # card: title + text + <a href> links, mixed RU/EN
      Toolbar.tsx         # a few buttons
    styles.css
```

No second `package.json`: react, react-dom, vite, `@vitejs/plugin-react`, and `@babel/core` are all present in the root `devDependencies`.

## Package consumption (the crux)

`examples/playground/vite.config.ts`:

```ts
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { stampLocVite } from '../../src/vite';

const root = import.meta.dirname; // Node >=20

export default defineConfig({
  root,
  plugins: [
    // Stamp the playground's own JSX with data-loc/data-comp, and mount the annotate endpoint.
    stampLocVite({ rootDir: root }),
    react()
  ],
  resolve: {
    alias: {
      // Order matters: the more specific subpath must precede the bare package entry.
      'semantic-inspector/vite': resolve(root, '../../src/vite.ts'),
      'semantic-inspector': resolve(root, '../../src/index.ts')
    }
  }
});
```

Consequences:
- Demo components do `import { SemanticInspector } from 'semantic-inspector'` → resolves to `src/index.ts` (live source).
- `stampLocVite` (imported from `src/vite.ts`) runs the Babel stamping pre-pass on the playground's `.tsx`, so the inspector shows **real** `data-loc` paths and `data-comp` names.
- `rootDir: root` means `data-loc` paths and the annotate output (`.semantic-inspector/annotations.{json,md}`) are scoped to the playground directory.
- Editing any `src/*` file hot-reloads the demo (no rebuild).

## What the page exercises

A single page composed of small nested components, chosen so that every inspector signal is reachable:

- **Sidebar → repeated `NavItem`** with Russian labels ("Сюжеты", "Рубрики", "Подписки", …) and a `data-testid` each. Exercises sibling **index/total**, the **component path** (`App › Sidebar › NavItem`), **testid** attribute, and the headline **"пилюля" cross-language annotate** scenario (name a Russian-labelled element with a short handle, then resolve it later by name).
- **`ContentCard`** instances with mixed RU/EN text and `<a href>` links. Exercises the **text** signal and the **href** attribute (and makes the README's PII/href caveat tangible).
- **`Toolbar`** with a few buttons.
- An **on-page legend** documenting the gestures: inspect `Alt+Shift+S` (click = copy text, ⇧click = screenshot), annotate `Alt+Shift+A` (click = open name editor), `Esc` exits.
- The inspector is mounted in `main.tsx` as `<SemanticInspector annotate onAnnotate={(a) => console.log('annotated', a)} onCopy={(k, p) => console.log('copied', k, p)} />`. A code comment shows how a real consumer would gate it behind `import.meta.env.DEV` + `React.lazy`; the playground mounts it directly since it is itself a dev tool.

## Dev / build wiring

Root `package.json` scripts:

```jsonc
"dev:example": "vite --config examples/playground/vite.config.ts",
"build:example": "vite build --config examples/playground/vite.config.ts"
```

`root` is set inside the config, so `index.html` resolves from `examples/playground/` and the build output lands in `examples/playground/dist/`.

## CI

A new lightweight job in `.github/workflows/ci.yml`:

- `npm ci`
- `tsc -p examples/playground/tsconfig.json --noEmit` (typecheck the playground against the live source)
- `npm run build:example` (catches a breaking package API / alias-resolution change)

Add this job to the required-checks list in `RELEASING.md`. It reuses the existing install; no second `npm install`.

## Isolation from root tooling

- Root `tsconfig.json` keeps `include: ["src"]` → the playground is excluded from the package typecheck. The playground's own `tsconfig.json` (extending the root, adding this directory and DOM libs already configured) is used only by the CI example-typecheck.
- `vitest` `include: ['src/**/*.test.{ts,tsx}']` → the playground is untouched; no unit tests are added.
- `biome.json` `files.includes` is extended with `examples/**/*.{ts,tsx}` so the demo code is linted/formatted with the same config (it is our code).
- npm `files: ["dist"]` → the playground is never in the published tarball; `publint`/`attw` are unaffected.

## Artifacts / .gitignore

Add to the repo `.gitignore`:

```gitignore
.semantic-inspector/
examples/playground/dist/
```

`.semantic-inspector/` is the dogfooded annotate output the playground writes; it is dev noise in this repo (consumers of the package commit theirs, but here it should not be committed).

## Testing strategy

The playground is a **manual visual harness**. Its automated guard is the CI job (typecheck + `vite build`): compiling and bundling proves the package's public API and the Vite/Babel plugin still wire up. No vitest unit tests are added, because the page is composition glue with no isolated logic worth unit-testing — adding tests there would test React/Vite, not our code.

`examples/playground/README.md` carries a manual checklist:

1. From the repo root: `npm run dev:example`, open the printed URL.
2. Press `Alt+Shift+S`; hover a `NavItem` — confirm the overlay shows the component, `file:line:col`, text, `index/total`, path, and `testid`.
3. Click a `NavItem` — confirm the text identifier is copied; `Shift+click` — confirm a PNG is copied.
4. Press `Alt+Shift+A`; click a Russian-labelled `NavItem`; name it "пилюля"; Save.
5. Confirm `examples/playground/.semantic-inspector/annotations.json` and `annotations.md` were written, with the durable anchor (not a raw line number).

## Docs

- `examples/playground/README.md` — run instructions + the checklist above.
- Root `README.md` — one "Try it locally: `npm run dev:example`" line near the Demo section.

## Edge cases / risks

- **Alias order:** the `semantic-inspector/vite` entry must precede the bare `semantic-inspector` entry so the subpath import is not shadowed.
- **`@babel/core` presence:** `stampLocVite` needs it; it is a root devDep, so the playground (reusing root deps) has it.
- **`import.meta.dirname`:** requires Node ≥ 20 (the repo's `engines.node` floor), so it is safe in the config.
- **Annotate write target:** the endpoint writes into `examples/playground/.semantic-inspector/`, which is gitignored — no accidental commits of demo annotations.
- **modern-screenshot:** lazily imported by the screenshot path; works in the dev server, loaded only on ⇧click.
```
