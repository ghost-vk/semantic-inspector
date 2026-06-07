# Releasing

`semantic-inspector` publishes to npm from `.github/workflows/publish.yml` when a GitHub Release
is published. The pipeline is hardened; a few one-time settings must be configured in the GitHub
and npm UIs (they can't live in the repo).

## One-time setup

### 1. npm OIDC Trusted Publishing

The publish workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) — no
long-lived token.

1. On npmjs.com → the `semantic-inspector` package → **Settings → Trusted Publisher**.
2. Add GitHub Actions as the publisher: repository `ghost-vk/semantic-inspector`, workflow
   `publish.yml`, environment `npm-production`.
3. Delete any legacy `NPM_TOKEN` repo secret — it is no longer used.

Trusted Publishing requires npm ≥ 11.5; the workflow upgrades npm before publishing.

### 2. Branch protection on `main`

CI gates are only enforcing if `main` is protected:

1. Repo **Settings → Branches → Add rule** for `main`.
2. Require a pull request before merging.
3. Require status checks to pass, selecting: `lint-and-typecheck`, `test (20)`, `test (22)`,
   `test (24)`, `package`.
4. Require branches to be up to date before merging.

### 3. GitHub Environment

Create an environment named `npm-production` (**Settings → Environments**). Optionally add required
reviewers — the publish job is gated on it.

## Cutting a release

1. Land changes via PR (each user-facing change ships a Changeset: `npx changeset`).
2. Bump the version + update `CHANGELOG.md`: `npm run version` (consumes pending changesets).
3. Commit and merge the version bump.
4. Create a GitHub Release tagged `vX.Y.Z` where `X.Y.Z` **matches** `package.json` (the workflow
   fails the publish otherwise).
5. The workflow validates, builds, publishes with provenance, then installs the published version
   from npm and smoke-tests it (`verify-published`).

## Rollback (npm publishes are immutable)

You cannot overwrite a published version. To recover from a bad release:

- Publish a fixed patch (`x.y.z+1`); npm points `latest` at it. If needed:
  `npm dist-tag add semantic-inspector@x.y.z+1 latest`.
- Warn installers off the bad version: `npm deprecate semantic-inspector@x.y.z "broken, use x.y.z+1"`.
- `npm unpublish` is restricted (≤72h, no dependents) and discouraged — prefer deprecate.

## Prereleases

Use a dist-tag so a prerelease never becomes the default install:
`npx changeset pre enter next` → version → publish (the `release` script publishes to the `next`
tag while in pre mode).
