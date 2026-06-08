import { resolveComp } from './resolveTarget';
import { ATTR_WHITELIST, cappedPath, normalizeText, pushPathSegment } from './semanticShape';
import type { SemanticInfo } from './types';

const LOC_ATTR = 'data-loc';
const COMP_ATTR = 'data-comp';

/**
 * Read semantic signals from a clicked element into a SemanticInfo. Pure (no DOM mutation, no
 * side effects). Called once per text copy — never on a mousemove frame.
 */
export function extractSemantics(el: Element): SemanticInfo {
  const info: SemanticInfo = { comp: resolveComp(el), loc: el.getAttribute(LOC_ATTR) };
  const text = extractText(el);
  if (text) info.text = text;
  const idx = siblingIndex(el);
  if (idx) {
    info.index = idx.index;
    info.total = idx.total;
  }
  const path = componentPath(el);
  if (path.length) info.path = path;
  const attrs = pickAttrs(el);
  if (attrs) info.attrs = attrs;
  return info;
}

function extractText(el: Element): string | undefined {
  return normalizeText(el.textContent ?? '');
}

function siblingIndex(el: Element): { index: number; total: number } | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const comp = el.getAttribute(COMP_ATTR);
  const peers = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName && c.getAttribute(COMP_ATTR) === comp
  );
  if (peers.length <= 1) return null;
  return { index: peers.indexOf(el) + 1, total: peers.length };
}

function componentPath(el: Element): string[] {
  // Collect data-comp values leaf→root (consecutive dups collapsed), then cap + flip to root→leaf.
  const chain: string[] = [];
  let node: Element | null = el;
  while (node) {
    pushPathSegment(chain, node.getAttribute(COMP_ATTR));
    node = node.parentElement;
  }
  return cappedPath(chain);
}

function pickAttrs(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of ATTR_WHITELIST) {
    const v = el.getAttribute(name);
    if (v != null) out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
