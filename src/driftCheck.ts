import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAnnotations } from './annotationStore';
import { collectSourceFiles } from './collectSourceFiles';
import { resolveAnchor } from './resolveAnchor';
import { staticAnchors } from './staticAnchors';
import type { DriftResult, StaticElement } from './types';

const DRIFTED = new Set(['moved', 'missing', 'ambiguous']);

/** Re-resolve every annotation against the current source tree under `root`. */
export function driftCheck(root: string, opts: { include?: string[] } = {}): DriftResult {
  const file = readAnnotations(root);
  const names = Object.keys(file.annotations);
  if (names.length === 0) return { entries: [], drifted: 0, ok: 0 };

  const elements: StaticElement[] = [];
  for (const rel of collectSourceFiles(root, opts.include)) {
    let source: string;
    try {
      source = readFileSync(resolve(root, rel), 'utf8');
    } catch {
      continue;
    }
    try {
      elements.push(...staticAnchors(rel, source));
    } catch {
      console.warn(`semantic-inspector: skipped ${rel} (parse error)`);
    }
  }

  const entries = names.map((name) => {
    const a = file.annotations[name];
    return resolveAnchor(name, a.anchor, a.lastSeen, elements);
  });
  const drifted = entries.filter((e) => DRIFTED.has(e.verdict)).length;
  const ok = entries.filter((e) => e.verdict === 'resolved').length;
  return { entries, drifted, ok };
}
