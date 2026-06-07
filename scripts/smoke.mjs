// Post-build smoke test of the published artifact (run after `npm run build`).
// Validates the npm contract that source tests + tsc never exercise: the exports map resolves,
// the babel entry is a callable named export, and the runtime entry is free of build-time deps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// CJS babel entry exports a callable plugin factory (named export, not default).
const babel = require('../dist/babel.cjs');
assert.equal(typeof babel.stampLocBabel, 'function', 'dist/babel.cjs must export a callable stampLocBabel');

// The runtime entry must not pull build-time deps.
const indexEsm = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
assert.ok(!/@babel\/core/.test(indexEsm), 'dist/index.js must not reference @babel/core');
assert.ok(
  !/from ['"]modern-screenshot['"]/.test(indexEsm),
  'dist/index.js must not statically import modern-screenshot'
);

// The runtime ESM entry exposes the public API and hides internals.
const mod = await import('../dist/index.js');
assert.ok(mod.SemanticInspector && mod.useInspector, 'index must export SemanticInspector + useInspector');
assert.ok(!('resolveTarget' in mod) && !('copyText' in mod), 'internals must not be re-exported from the root');

console.log('✓ dist smoke test passed');
