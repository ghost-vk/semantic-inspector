/**
 * The anchor-shape contract: the size caps, attribute whitelist, and normalization rules that MUST
 * be byte-identical everywhere an element's semantic shape is computed — the runtime DOM extractor
 * (extractSemantics), the static AST extractor (staticAnchors), and (implicitly) the data-loc stamp.
 * If a cap or whitelist diverges between the runtime and the static side, a previously-annotated
 * element silently flips to `missing`. Centralizing them here makes that divergence impossible.
 *
 * Browser-safe: no node built-ins, no @babel/core — so the runtime bundle and the node-only drift
 * CLI can both import it without dragging build-time deps into the browser graph.
 */

/** Max code points of visible text retained on an anchor; longer text is truncated with "…". */
export const TEXT_CAP = 160;

/** Max component-path entries retained (the ones closest to the leaf). */
export const PATH_CAP = 4;

/** Attributes copied verbatim onto an anchor, in resolver-priority order. */
export const ATTR_WHITELIST = ['id', 'data-testid', 'name', 'href', 'type'] as const;

export type WhitelistedAttr = (typeof ATTR_WHITELIST)[number];

/**
 * Collapse runs of whitespace to a single space, trim, and cap to TEXT_CAP code points (the slice
 * is by code point, so the cap never splits a surrogate pair / astral char). Returns undefined for
 * empty-or-blank input. The single source of text normalization for both extractors.
 */
export function normalizeText(raw: string): string | undefined {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  const cp = [...collapsed];
  return cp.length > TEXT_CAP ? `${cp.slice(0, TEXT_CAP).join('')}…` : collapsed;
}

/**
 * Append a component name to a leaf→root chain, collapsing consecutive duplicates and skipping
 * falsy names. Mutates and returns `chain` so callers can build it incrementally during a
 * leaf→root walk. Pair with cappedPath() to finalize.
 */
export function pushPathSegment(chain: string[], comp: string | null | undefined): string[] {
  if (comp && chain[chain.length - 1] !== comp) chain.push(comp);
  return chain;
}

/**
 * Finalize a leaf→root component chain: keep the PATH_CAP entries closest to the leaf, then present
 * them root→leaf (the order anchors are stored and rendered in).
 */
export function cappedPath(leafToRoot: string[]): string[] {
  return leafToRoot.slice(0, PATH_CAP).reverse();
}
