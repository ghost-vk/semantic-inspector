import { extractSemantics } from './extractSemantics';
import type { AnnotationAnchor, AnnotationDraft, AnnotationInput, AnnotationLastSeen } from './types';

/**
 * Capture the durable anchor + the `lastSeen` hint from an element's CURRENT DOM state. Call this
 * at click time (when the highlight freezes), so the snapshot reflects exactly what the user
 * selected — not what the DOM looks like later when Save is pressed. Reads the DOM.
 */
export function captureAnchor(el: Element): { anchor: AnnotationAnchor; lastSeen: AnnotationLastSeen } {
  const sem = extractSemantics(el);
  return {
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

/**
 * Assemble the POST payload from the draft's captured anchor and the editor fields. Pure — no DOM
 * read, no mutation, no network — so the persisted anchor is the click-time snapshot, not a re-read.
 */
export function buildAnnotation(draft: AnnotationDraft, name: string, tags: string[], note: string): AnnotationInput {
  const trimmedNote = note.trim();
  return {
    name: name.trim(),
    tags: tags.length ? tags : undefined,
    note: trimmedNote ? trimmedNote : undefined,
    anchor: draft.anchor,
    lastSeen: draft.lastSeen
  };
}
