import { type JSX, useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import type { CopyKind, SemanticInspectorProps } from './types';
import { useInspector } from './useInspector';

// How long the copy toast stays visible (ms).
const TOAST_MS = 1400;

/**
 * Semantic inspector. Renders nothing until toggled by the hotkey. Gating (where to mount) is
 * the consumer's responsibility: mount it under your dev flag, ideally via React.lazy, so it is
 * not pulled into the production bundle.
 */
export function SemanticInspector(props: SemanticInspectorProps): JSX.Element | null {
  const [toast, setToast] = useState<string | null>(null);

  // Auto-hide the toast; cleanup cancels the pending timer (including on unmount).
  // Note: two identical consecutive toasts share one window — acceptable for a dev tool.
  useEffect(() => {
    if (toast == null) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const { active, target } = useInspector({
    hotkey: props.hotkey,
    formatText: props.formatText,
    onCopy: (kind: CopyKind, payload: string) => {
      setToast(kind === 'text' ? `✓ ${payload}` : '✓ screenshot copied');
      props.onCopy?.(kind, payload);
    },
    onError: (kind: CopyKind, err: unknown) => {
      setToast(`✗ ${kind} failed`);
      props.onError?.(kind, err);
    }
  });

  if (!active && !toast) return null;
  return <Overlay target={active ? target : null} toast={toast} />;
}
