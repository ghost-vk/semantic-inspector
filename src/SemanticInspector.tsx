import { useRef, useState } from 'react';
import { Overlay } from './Overlay';
import type { CopyKind, SemanticInspectorProps } from './types';
import { useInspector } from './useInspector';

const TOAST_MS = 1400;

/**
 * Семантический инспектор. Сам по себе ничего не показывает, пока не включён
 * хоткеем. Гейтинг (где монтировать) — забота консьюмера: монтируй под своим
 * dev-флагом и желательно через React.lazy, чтобы не тянуть в prod-бандл.
 */
export function SemanticInspector(props: SemanticInspectorProps) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setToast(null);
    }, TOAST_MS);
  };

  const { active, target } = useInspector({
    hotkey: props.hotkey,
    formatText: props.formatText,
    onCopy: (kind: CopyKind, payload: string) => {
      flash(kind === 'text' ? `✓ ${payload}` : '✓ screenshot copied');
      props.onCopy?.(kind, payload);
    },
    onError: (kind: CopyKind, err: unknown) => {
      flash(`✗ ${kind} failed`);
      props.onError?.(kind, err);
    }
  });

  if (!active && !toast) return null;
  return <Overlay target={active ? target : null} toast={toast} />;
}
