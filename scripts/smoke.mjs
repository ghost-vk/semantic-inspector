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

// The browser entry must stay free of node built-ins. tsup/esbuild rewrites `node:fs` -> `fs` in
// the bundle, so match BOTH forms. This catches a future value-import (not `import type`) of the
// node-only annotation store/middleware leaking into the browser graph.
const NODE_BUILTINS = ['fs', 'path', 'http', 'https', 'os', 'crypto', 'child_process', 'net', 'stream'];
const builtinImport = new RegExp(`from\\s*['"](?:node:)?(?:${NODE_BUILTINS.join('|')})['"]`);
assert.ok(
  !builtinImport.test(indexEsm),
  'dist/index.js must not import a node built-in (browser entry must stay node-free)'
);
assert.ok(
  !/annotationStore|annotationMiddleware|createAnnotationMiddleware|writeAnnotations/.test(indexEsm),
  'dist/index.js must not include the node-only annotation store/middleware'
);

// The runtime ESM entry exposes the public API and hides internals.
const mod = await import('../dist/index.js');
assert.ok(mod.SemanticInspector && mod.useInspector, 'index must export SemanticInspector + useInspector');
assert.ok(!('resolveTarget' in mod) && !('copyText' in mod), 'internals must not be re-exported from the root');

console.log('✓ dist smoke test passed');
