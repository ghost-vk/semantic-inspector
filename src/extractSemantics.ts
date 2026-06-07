import { resolveComp } from './resolveTarget';
import type { SemanticInfo } from './types';

const LOC_ATTR = 'data-loc';
const COMP_ATTR = 'data-comp';
const TEXT_CAP = 160;
const PATH_CAP = 4;
const ATTR_WHITELIST = ['id', 'data-testid', 'name', 'href', 'type'] as const;

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
  const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return undefined;
  return raw.length > TEXT_CAP ? `${raw.slice(0, TEXT_CAP)}…` : raw;
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
  // Collect data-comp values leaf→root, collapsing consecutive duplicates.
  const chain: string[] = [];
  let node: Element | null = el;
  while (node) {
    const comp = node.getAttribute(COMP_ATTR);
    if (comp && chain[chain.length - 1] !== comp) chain.push(comp);
    node = node.parentElement;
  }
  // Keep the 4 closest to the leaf (first in leaf→root order), then present root→leaf.
  return chain.slice(0, PATH_CAP).reverse();
}

function pickAttrs(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of ATTR_WHITELIST) {
    const v = el.getAttribute(name);
    if (v != null) out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
