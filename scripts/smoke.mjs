// Post-build smoke test of the published artifact (run after `npm run build`).
// Validates the npm contract that source tests + tsc never exercise: the exports map resolves, the
// babel entry is a callable named export, the runtime entries are free of build-time deps + drift
// internals, and the published bin actually runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// CJS babel entry exports a callable plugin factory (named export, not default).
const babel = require('../dist/babel.cjs');
assert.equal(typeof babel.stampLocBabel, 'function', 'dist/babel.cjs must export a callable stampLocBabel');

// --- Browser-entry safety fence (ESM + CJS) ---------------------------------------------------
// The runtime entries must not pull build-time deps, node built-ins, the node-only annotation
// store/middleware, or any drift-CLI internal — all of those would leak node code into the
// consumer's browser bundle.
const NODE_BUILTINS = ['fs', 'path', 'http', 'https', 'os', 'crypto', 'child_process', 'net', 'stream'];
const builtinEsm = new RegExp(`from\\s*['"](?:node:)?(?:${NODE_BUILTINS.join('|')})['"]`);
const builtinCjs = new RegExp(`require\\(['"](?:node:)?(?:${NODE_BUILTINS.join('|')})['"]\\)`);
const nodeOnlySymbols = /annotationStore|annotationMiddleware|createAnnotationMiddleware|writeAnnotations/;
// Drift CLI internals — must never be reachable from the browser graph.
const driftSymbols = /\b(driftCheck|driftCli|driftFix|resolveAnchor|staticAnchors|collectSourceFiles)\b/;

const fenceRuntimeEntry = (file, builtinRe) => {
  const code = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  assert.ok(!/@babel\/core/.test(code), `dist/${file} must not reference @babel/core`);
  assert.ok(!/from ['"]modern-screenshot['"]/.test(code), `dist/${file} must not statically import modern-screenshot`);
  assert.ok(!builtinRe.test(code), `dist/${file} must not import a node built-in (browser entry must stay node-free)`);
  assert.ok(!nodeOnlySymbols.test(code), `dist/${file} must not include the node-only annotation store/middleware`);
  assert.ok(!driftSymbols.test(code), `dist/${file} must not include drift-CLI internals`);
};

fenceRuntimeEntry('index.js', builtinEsm);
fenceRuntimeEntry('index.cjs', builtinCjs);

// The runtime ESM entry exposes the public API and hides internals.
const mod = await import('../dist/index.js');
assert.ok(mod.SemanticInspector && mod.useInspector, 'index must export SemanticInspector + useInspector');
assert.ok(!('resolveTarget' in mod) && !('copyText' in mod), 'internals must not be re-exported from the root');

// --- Published bin: actually run it ------------------------------------------------------------
// cli.ts ships with zero unit tests (coverage-excluded); this is the only place the built bin is
// executed, so a broken shebang, a bad parseArgs option, a stale chunk ref, or the silent
// version() fallback would ship green without it.
const CLI = new URL('../dist/cli.js', import.meta.url);
const runBin = (args, cwd) => spawnSync(process.execPath, [CLI.pathname, ...args], { cwd, encoding: 'utf8' });

const ver = runBin(['--version']);
assert.equal(ver.status, 0, '`--version` must exit 0');
assert.equal(
  ver.stdout.trim(),
  pkg.version,
  `bin --version (${ver.stdout.trim()}) must equal package.json version (${pkg.version})`
);

const help = runBin(['--help']);
assert.equal(help.status, 0, '`--help` must exit 0');
assert.match(help.stdout, /semantic-inspector check/, '`--help` must describe the check command');

// `check --json` on a clean tree exits 0 and emits the documented agent-contract key set.
const tmp = mkdtempSync(join(tmpdir(), 'si-smoke-'));
try {
  mkdirSync(join(tmp, '.semantic-inspector'), { recursive: true });
  writeFileSync(join(tmp, '.semantic-inspector', 'annotations.json'), JSON.stringify({ version: 1, annotations: {} }));
  const json = runBin(['check', '--json', '--root', tmp]);
  assert.equal(json.status, 0, '`check --json` on a clean tree must exit 0');
  const report = JSON.parse(json.stdout);
  for (const key of ['drifted', 'ok', 'skipped', 'entries']) {
    assert.ok(key in report, `--json report must contain the "${key}" key`);
  }
  assert.ok(Array.isArray(report.entries), '--json "entries" must be an array');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('✓ dist smoke test passed');
