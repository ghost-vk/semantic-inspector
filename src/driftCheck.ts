import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAnnotations } from './annotationStore';
import { collectSourceFiles } from './collectSourceFiles';
import { buildElementIndex, isDrift, resolveAnchorIndexed } from './resolveAnchor';
import { staticAnchors } from './staticAnchors';
import type { DriftResult, StaticElement } from './types';

/**
 * Hard cap on a single source file's byte size before it is handed to Babel. Babel's parser keeps
 * the whole AST plus working state in memory — on the order of a few hundred× the source size — so
 * one multi-MB file can drive V8 to a fatal out-of-memory abort. That abort is NOT a catchable
 * exception: it bypasses the try/catch around `staticAnchors` and crashes the entire `check` run
 * (and any CI gate built on it) with a confusing non-zero exit instead of the clean exit 2 the
 * contract promises. Files over the cap are skipped + counted in `skipped`, never read.
 */
const MAX_PARSE_BYTES = 2_000_000;

/** Re-resolve every annotation against the current source tree under `root`. */
export function driftCheck(root: string, opts: { include?: string[] } = {}): DriftResult {
  const file = readAnnotations(root);
  const names = Object.keys(file.annotations);
  if (names.length === 0) return { entries: [], drifted: 0, ok: 0, skipped: 0 };

  const elements: StaticElement[] = [];
  let skipped = 0;
  for (const rel of collectSourceFiles(root, opts.include)) {
    const abs = resolve(root, rel);
    let size: number;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }
    if (size > MAX_PARSE_BYTES) {
      skipped++;
      console.warn(
        `semantic-inspector: skipped ${rel} (${(size / 1e6).toFixed(1)}MB exceeds ${MAX_PARSE_BYTES / 1e6}MB parse cap)`
      );
      continue;
    }
    let source: string;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    try {
      elements.push(...staticAnchors(rel, source));
    } catch {
      skipped++;
      console.warn(`semantic-inspector: skipped ${rel} (parse error)`);
    }
  }

  const index = buildElementIndex(elements);
  const entries = names.map((name) => {
    const a = file.annotations[name];
    return resolveAnchorIndexed(name, a.anchor, a.lastSeen, index);
  });
  const drifted = entries.filter((e) => isDrift(e.verdict)).length;
  const ok = entries.filter((e) => e.verdict === 'resolved').length;
  return { entries, drifted, ok, skipped };
}
