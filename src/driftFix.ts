import { readAnnotations, upsert, writeAnnotations } from './annotationStore';
import type { AnnotationInput, DriftResult } from './types';

/**
 * Relock every fixable entry (resolved at a loc different from the recorded one — covers `moved`
 * and unstamped-but-now-found anchors) by updating its lastSeen + updatedAt. Anchor is never
 * changed. Persists via writeAnnotations (regenerates the .md mirror). Returns the count fixed.
 */
export function driftFix(root: string, result: DriftResult, now: string): number {
  const fixable = result.entries.filter((e) => Boolean(e.resolvedLoc) && e.resolvedLoc !== e.lastSeenLoc);
  if (fixable.length === 0) return 0;

  let file = readAnnotations(root);
  for (const e of fixable) {
    const a = file.annotations[e.name];
    if (!a) continue;
    const loc = e.resolvedLoc as string;
    const input: AnnotationInput = {
      name: a.name,
      tags: a.tags,
      note: a.note,
      anchor: a.anchor,
      lastSeen: { file: loc.split(':')[0], loc }
    };
    file = upsert(file, input, now);
  }
  writeAnnotations(root, file);
  return fixable.length;
}
