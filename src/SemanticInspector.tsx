import { type JSX, useEffect, useState } from 'react';
import { AnnotationEditor } from './AnnotationEditor';
import { saveAnnotation } from './annotationClient';
import { ANNOTATION_ENDPOINT } from './annotationEndpoint';
import { buildAnnotation } from './buildAnnotation';
import { Overlay } from './Overlay';
import type { Annotation, CopyKind, SemanticInspectorProps } from './types';
import { useInspector } from './useInspector';

// How long the copy/save toast stays visible (ms).
const TOAST_MS = 1400;

/**
 * Semantic inspector. Renders nothing until toggled by a hotkey. Gating (where to mount) is the
 * consumer's responsibility: mount it under your dev flag, ideally via React.lazy, so it is not
 * pulled into the production bundle.
 */
export function SemanticInspector(props: SemanticInspectorProps): JSX.Element | null {
  const [toast, setToast] = useState<string | null>(null);
  const [annoError, setAnnoError] = useState<string | null>(null);

  // Auto-hide the toast; cleanup cancels the pending timer (including on unmount).
  useEffect(() => {
    if (toast == null) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const { active, mode, target, draft, closeDraft } = useInspector({
    hotkey: props.hotkey,
    semantic: props.semantic,
    formatText: props.formatText,
    annotate: props.annotate,
    annotateHotkey: props.annotateHotkey,
    onCopy: (kind: CopyKind, payload: string) => {
      setToast(kind === 'text' ? `✓ ${payload}` : '✓ screenshot copied');
      props.onCopy?.(kind, payload);
    },
    onError: (kind: CopyKind, err: unknown) => {
      setToast(`✗ ${kind} failed`);
      props.onError?.(kind, err);
    }
  });

  const endpoint = props.annotateEndpoint ?? ANNOTATION_ENDPOINT;

  const submitAnnotation = (name: string, tags: string[], note: string): void => {
    if (!draft) return;
    const input = buildAnnotation(draft, name, tags, note);
    saveAnnotation(endpoint, input).then(
      (saved: Annotation) => {
        setToast(`✓ ${saved.name}`);
        setAnnoError(null);
        props.onAnnotate?.(saved);
        closeDraft();
      },
      (err: unknown) => {
        // Annotate has its own failure channel (not the copy-oriented onError): keep the editor open.
        setAnnoError('save failed');
        console.warn('[semantic-inspector] annotation save failed:', err);
      }
    );
  };

  const cancelAnnotation = (): void => {
    setAnnoError(null);
    closeDraft();
  };

  if (!active && !toast) return null;
  return (
    <>
      <Overlay target={active ? target : null} toast={toast} mode={mode} />
      {draft && (
        <AnnotationEditor
          target={draft.target}
          error={annoError}
          onSubmit={submitAnnotation}
          onCancel={cancelAnnotation}
        />
      )}
    </>
  );
}
