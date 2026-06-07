import { extractSemantics } from './extractSemantics';
import type { AnnotationInput } from './types';

/**
 * Build the POST payload for an annotated element. The anchor is the existing semantic descriptor
 * (so resolution reuses the same signals); `lastSeen` is the data-loc snapshot, used only as a hint.
 * Pure — no DOM mutation, no network.
 */
export function buildAnnotation(el: Element, name: string, tags: string[], note: string): AnnotationInput {
  const sem = extractSemantics(el);
  const trimmedNote = note.trim();
  return {
    name: name.trim(),
    tags: tags.length ? tags : undefined,
    note: trimmedNote ? trimmedNote : undefined,
    anchor: {
      comp: sem.comp,
      path: sem.path,
      text: sem.text,
      index: sem.index,
      total: sem.total,
      attrs: sem.attrs
    },
    lastSeen: { file: sem.loc ? sem.loc.split(':')[0] : null, loc: sem.loc }
  };
}
