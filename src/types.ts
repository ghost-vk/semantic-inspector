export type CopyKind = 'text' | 'screenshot';

/** Component name + source location resolved for an inspected element. */
export interface LocInfo {
  /** Component name (from data-comp) or a fallback (fiber displayName / file name / tag). */
  comp: string;
  /** "<path>:<line>:<col>" from data-loc, or null when the element is not stamped. */
  loc: string | null;
}

/**
 * LocInfo plus semantic signals about the clicked element. All extra fields are optional and
 * only populated when `semantic` is enabled (and when meaningful — e.g. index/total are omitted
 * for a lone element). Superset of LocInfo, so an existing `formatText: (t) => t.comp` keeps
 * working unchanged.
 */
export interface SemanticInfo extends LocInfo {
  /** Visible label: textContent, whitespace-collapsed, trimmed, capped at 160 (+ "…"). */
  text?: string;
  /** 1-based position among same-tag + same-data-comp siblings. Omitted if total <= 1. */
  index?: number;
  /** Count of same-tag + same-data-comp siblings. Omitted if <= 1. */
  total?: number;
  /** data-comp ancestor chain, root→leaf, consecutive duplicates collapsed, max 4 entries. */
  path?: string[];
  /** Whitelisted attributes present on the element: id, data-testid, name, href, type. */
  attrs?: Record<string, string>;
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
  /**
   * Enrich the copied text with semantic signals (visible text, sibling index, component path,
   * key attributes). Computed at click time only. Default false — copied text is unchanged.
   */
  semantic?: boolean;
  /**
   * Formats the clipboard text. Receives `SemanticInfo`; the extra fields are populated only when
   * `semantic` is true. Default: `${comp} — ${loc}` (single line), or the multi-line semantic
   * block when `semantic` is true. Backward compatible — `LocInfo` is a subset of `SemanticInfo`.
   */
  formatText?: (t: SemanticInfo) => string;
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
