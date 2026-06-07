# Contributing

Thanks for helping improve `semantic-inspector`.

## Setup

```bash
npm ci
npm run build   # dist/ is generated and gitignored — build once after cloning before `npm link`
```

## Development loop

| Command | What it does |
| --- | --- |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Watch mode |
| `npm run test:cov` | Tests + coverage thresholds |
| `npm run typecheck` | `tsc --noEmit` (with `isolatedDeclarations`) |
| `npm run lint` | Biome lint + format check |
| `npm run lint:fix` | Apply Biome safe fixes |
| `npm run build` | Build ESM + CJS + `.d.ts` via tsup |
| `npm run lint:pkg` | Validate the built package (`publint` + `attw`) |
| `npm run test:dist` | Smoke-test the built artifact |

## Conventions

- **JSDoc on exported symbols must be English** — it ships into `dist/*.d.ts` as the consumer's
  IntelliSense.
- All exports need explicit types (`isolatedDeclarations` is enabled).
- `dist/` is generated; never edit or commit it.
- Add a Changeset for every user-facing change: `npx changeset`.
- Keep the public surface minimal (`SemanticInspector`, `useInspector`, types, and the
  `stampLocVite` / `stampLocBabel` entries). Internal helpers stay unexported.

## Pull requests

Run `npm run lint && npm run typecheck && npm test && npm run build && npm run lint:pkg` before
opening a PR. CI runs the same gates across Node 20/22/24.
