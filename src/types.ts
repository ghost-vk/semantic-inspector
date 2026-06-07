export type CopyKind = 'text' | 'screenshot';

/** Component name + source location resolved for an inspected element. */
export interface LocInfo {
  /** Component name (from data-comp) or a fallback (fiber displayName / file name / tag). */
  comp: string;
  /** "<path>:<line>:<col>" from data-loc, or null when the element is not stamped. */
  loc: string | null;
}

export interface InspectTarget extends LocInfo {
  /** The resolved DOM element (nearest ancestor with data-loc, or the element itself). */
  el: Element;
  /** Geometry for the overlay highlight. */
  rect: DOMRect;
}

export interface SemanticInspectorProps {
  /**
   * Toggle hotkey. Default 'Alt+Shift+S'.
   *
   * Format: modifiers (`Alt`, `Shift`, `Ctrl`/`Control`, `Meta`/`Cmd`) joined with `+`
   * followed by a final key, e.g. 'Ctrl+Cmd+I'. Matching is case-insensitive and also
   * accepts the physical `event.code` (so layout-shifted glyphs still work). `Esc` always exits.
   */
  hotkey?: string;
  /** Formats the clipboard text. Default: `${comp} — ${loc}` (or `${comp}` when loc is null). */
  formatText?: (t: LocInfo) => string;
  /**
   * Called after a successful copy. For kind `'text'`, `payload` is the copied string; for
   * kind `'screenshot'`, `payload` is the component name (the PNG itself goes to the clipboard,
   * not to this callback).
   */
  onCopy?: (kind: CopyKind, payload: string) => void;
  /** Called when a copy fails (clipboard rejection / screenshot failure). */
  onError?: (kind: CopyKind, err: unknown) => void;
}

/** Return value of `useInspector`. */
export interface UseInspectorResult {
  active: boolean;
  target: InspectTarget | null;
}
