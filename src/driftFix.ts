import { readAnnotations, upsert, writeAnnotations } from './annotationStore';
import { isDrift } from './resolveAnchor';
import type { AnnotationInput, DriftResult } from './types';

/**
 * Relock every fixable entry (resolved at a loc different from the recorded one — covers `moved`
 * and unstamped-but-now-found anchors) by updating its lastSeen + updatedAt. Anchor is never
 * changed. Persists via writeAnnotations (regenerates the .md mirror). Returns the names actually
 * relocked, so the caller can derive the post-fix result without re-scanning (see applyFix).
 */
export function driftFix(root: string, result: DriftResult, now: string): string[] {
  const fixable = result.entries.filter((e) => Boolean(e.resolvedLoc) && e.resolvedLoc !== e.lastSeenLoc);
  if (fixable.length === 0) return [];

  let file = readAnnotations(root);
  const fixed: string[] = [];
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
    fixed.push(e.name);
  }
  if (fixed.length > 0) writeAnnotations(root, file);
  return fixed;
}

/**
 * Derive the post-`--fix` result in memory instead of re-scanning + re-parsing the whole tree. A
 * relocked entry's lastSeen now equals its resolvedLoc, so its verdict becomes `resolved`; every
 * other entry — and every static element — is unchanged. So this is identical to re-running
 * driftCheck after the write, without the second full parse pass. Pure.
 */
export function applyFix(result: DriftResult, fixedNames: string[]): DriftResult {
  if (fixedNames.length === 0) return result;
  const fixed = new Set(fixedNames);
  const entries = result.entries.map((e) =>
    fixed.has(e.name) && e.resolvedLoc ? { ...e, verdict: 'resolved' as const, lastSeenLoc: e.resolvedLoc } : e
  );
  const drifted = entries.filter((e) => isDrift(e.verdict)).length;
  const ok = entries.filter((e) => e.verdict === 'resolved').length;
  return { ...result, entries, drifted, ok };
}
