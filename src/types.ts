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

/** Durable signals describing an annotated element, used to re-find it after refactors. */
export interface AnnotationAnchor {
  comp: string;
  path?: string[];
  text?: string;
  index?: number;
  total?: number;
  attrs?: Record<string, string>;
}

/** A non-authoritative pointer to where the element was last seen. May be stale. */
export interface AnnotationLastSeen {
  /** Relative file path (no line/col), or null when unstamped. */
  file: string | null;
  /** "<path>:<line>:<col>" snapshot, or null when unstamped. Hint only — verify before trusting. */
  loc: string | null;
}

/** One named annotation as persisted on disk. */
export interface Annotation {
  name: string;
  tags?: string[];
  note?: string;
  anchor: AnnotationAnchor;
  lastSeen: AnnotationLastSeen;
  createdAt: string;
  updatedAt: string;
}

/** On-disk shape of annotations.json. */
export interface AnnotationFile {
  version: 1;
  annotations: Record<string, Annotation>;
}

/** Payload the browser POSTs; the server adds timestamps and persists. */
export interface AnnotationInput {
  name: string;
  tags?: string[];
  note?: string;
  anchor: AnnotationAnchor;
  lastSeen: AnnotationLastSeen;
}

/** Inspector mode. Inspect and annotate are mutually exclusive. */
export type InspectMode = 'off' | 'inspect' | 'annotate';

/** Set when the user clicked an element in annotate mode (the editor is open). */
export interface AnnotationDraft {
  /** Live element + geometry, used for the editor's position and label. */
  target: InspectTarget;
  /** Durable descriptor captured at click time, so the saved anchor reflects what the user
   * selected — not whatever the DOM looks like seconds later when Save is pressed. */
  anchor: AnnotationAnchor;
  /** Non-authoritative file/loc hint captured alongside the anchor at click time. */
  lastSeen: AnnotationLastSeen;
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
  /** Enable annotate mode. Default false — no annotate hotkey, no editor, no network. */
  annotate?: boolean;
  /** Hotkey that toggles annotate mode. Default 'Alt+Shift+A'. */
  annotateHotkey?: string;
  /** Override the POST endpoint path. Default '/__semantic_inspector/annotations'. */
  annotateEndpoint?: string;
  /** Called after a successful annotation save. */
  onAnnotate?: (annotation: Annotation) => void;
}

/** Return value of `useInspector`. */
export interface UseInspectorResult {
  /** Back-compat: true whenever a mode is active (`mode !== 'off'`). */
  active: boolean;
  mode: InspectMode;
  target: InspectTarget | null;
  /** Non-null while the annotation editor is open. */
  draft: AnnotationDraft | null;
  /** Close the editor. */
  closeDraft: () => void;
}

/** A JSX host element recovered statically from source (AST analog of SemanticInfo). */
export interface StaticElement {
  /** Relative POSIX file path. */
  file: string;
  /** "<relpath>:<line>:<col>" — byte-identical to the data-loc stamp format. */
  loc: string;
  /** nearestComponentName, or null when no PascalCase component ancestor exists. */
  comp: string | null;
  /** Ancestor component-name chain, root→leaf, consecutive duplicates collapsed, max 4. */
  path: string[];
  /** Literal JSXText under the element, whitespace-collapsed, code-point-capped at 160. */
  text?: string;
  /** Whitelisted attributes with string-literal values: id, data-testid, name, href, type. */
  attrs: Record<string, string>;
}

/** Outcome of re-resolving one annotation against current source. */
export type DriftVerdict = 'resolved' | 'moved' | 'missing' | 'ambiguous' | 'unverifiable';

/** One annotation's drift result. */
export interface DriftEntry {
  name: string;
  verdict: DriftVerdict;
  /** lastSeen.loc from the annotation (may be null for an unstamped anchor). */
  lastSeenLoc: string | null;
  /** Where it resolves now: equal to lastSeenLoc when resolved, the new loc when moved, else null. */
  resolvedLoc: string | null;
  /** Ranked match candidates (score desc, loc asc). */
  candidates: { loc: string; score: number }[];
}

/** Aggregate drift result for the whole annotation set. */
export interface DriftResult {
  entries: DriftEntry[];
  /** Count of moved/missing/ambiguous entries (resolved + unverifiable excluded). */
  drifted: number;
  /** Count of resolved entries. */
  ok: number;
  /** Source files the scan could not analyze (over the parse byte cap, or a parse error). When
   * > 0 the scan was partial: some elements were never seen, so a `missing` verdict may be a false
   * positive. Surfaced in both report formats so a degraded run does not read as authoritative. */
  skipped: number;
}
