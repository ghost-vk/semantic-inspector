# Playground

A runnable React + Vite app for trying `semantic-inspector` against its **live source** — no build,
no publish. It imports the package via Vite aliases pointing at `../../src`, so editing the package
source hot-reloads here.

## Run

From the repository root:

```sh
npm install      # once, if you haven't
npm run dev:example
```

Open the URL Vite prints (default http://localhost:5173).

## What to try

1. **Inspect** — press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, hover a sidebar item. The
   overlay shows the component (`NavItem`), `file:line:col`, visible text, sibling `index/total`,
   the component path (`App › Sidebar › NavItem`), and the `data-testid`.
2. **Copy** — click to copy the text identifier; <kbd>Shift</kbd>+click to copy a PNG of the
   element. (Both go to the clipboard; see the console for the `onCopy` log.)
3. **Annotate** — press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>, click the "Topics" sidebar
   item, name it `pill`, Save. Then open
   [`.semantic-inspector/annotations.md`](./.semantic-inspector/annotations.md) — the element is now
   addressable by name, anchored on a durable descriptor (not a raw line number).
4. <kbd>Esc</kbd> exits either mode.

The annotate endpoint writes `.semantic-inspector/annotations.{json,md}` into this directory; it is
gitignored.

## How it's wired

`vite.config.ts` mounts `stampLocVite` (from `../../src/vite`) so this app's JSX is stamped with
`data-loc`/`data-comp` on the dev server, and aliases `semantic-inspector` /
`semantic-inspector/vite` to the package source. Stamping runs only on the dev server
(`apply: 'serve'`), so `vite build` produces an unstamped bundle — the build is used by CI only to
catch a breaking package change, not for the interactive experience.

### Stamping a build (`applyOnBuild`)

`vite build` produces an **unstamped** bundle by default — the inspector shows `S · no source`.
For staging / dev-stand builds where the inspector must work against the built app:

```ts
stampLocVite({ rootDir: root, applyOnBuild: true })
```

> **Security:** `applyOnBuild: true` embeds source file paths into the shipped DOM. Leave it **off**
> for any publicly shipped production build.
