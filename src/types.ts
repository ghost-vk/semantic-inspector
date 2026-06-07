export type CopyKind = 'text' | 'screenshot';

export interface InspectTarget {
  /** Имя компонента (data-comp) или fallback (fiber displayName / имя файла / тег). */
  comp: string;
  /** "<path>:<line>" из data-loc, либо null если элемент не заштампован. */
  loc: string | null;
  /** Реальный DOM-элемент (ближайший с data-loc, либо сам). */
  el: Element;
  /** Геометрия для оверлея. */
  rect: DOMRect;
}

export interface SemanticInspectorProps {
  /** Хоткей-toggle. Default 'Alt+Shift+S'. Формат: 'Alt+Shift+S', 'Ctrl+Cmd+I'. */
  hotkey?: string;
  /** Формат текста для буфера. Default: `${comp} — ${loc}` (или `${comp}` без loc). */
  formatText?: (t: { comp: string; loc: string | null }) => string;
  /** Колбэк после успешной копии — для телеметрии/тостов апа. */
  onCopy?: (kind: CopyKind, payload: string) => void;
  /** Колбэк при ошибке копии (clipboard reject / screenshot fail). */
  onError?: (kind: CopyKind, err: unknown) => void;
}
