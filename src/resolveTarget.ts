import type { InspectTarget } from './types';

const LOC_ATTR = 'data-loc';
const COMP_ATTR = 'data-comp';

/**
 * Resolve a component name for an element: data-comp → React fiber displayName → file base
 * (from data-loc) → tag name. Operates on the element as-is (no ancestor walk).
 */
export function resolveComp(el: Element): string {
  return el.getAttribute(COMP_ATTR) ?? fiberName(el) ?? fallbackName(el, el.getAttribute(LOC_ATTR));
}

/**
 * DOM element under the cursor → inspection target.
 *
 * Walks to the nearest ancestor carrying data-loc (stamped by the Babel plugin). If none
 * exists (prod build without stamps / foreign node), it falls back best-effort to: the name
 * from the React fiber, then the file name from data-loc, then the tag name.
 */
export function resolveTarget(el: Element | null): InspectTarget | null {
  if (!el) return null;
  const target = el.closest(`[${LOC_ATTR}]`) ?? el;
  const loc = target.getAttribute(LOC_ATTR);
  return { comp: resolveComp(target), loc, el: target, rect: target.getBoundingClientRect() };
}

function fallbackName(el: Element, loc: string | null): string {
  if (loc) {
    const base = loc
      .split(':')[0]
      .split('/')
      .pop()
      ?.replace(/\.[jt]sx?$/, '');
    if (base) return base;
  }
  return el.tagName.toLowerCase();
}

// React-internals fallback. _debugSource was removed in React 19, but the component name from
// fiber.type is still available (not minified in dev builds).
interface FiberLike {
  type: { displayName?: string; name?: string } | string | null | undefined;
  return: FiberLike | null;
}

function fiberName(el: Element): string | null {
  const host = el as Element & Record<string, FiberLike | undefined>;
  const key = Object.keys(host).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!key) return null;
  let fiber: FiberLike | null = host[key] ?? null;
  while (fiber) {
    const t = fiber.type;
    const name = t && typeof t !== 'string' ? (t.displayName ?? t.name) : undefined;
    if (name && /^[A-Z]/.test(name)) return name;
    fiber = fiber.return;
  }
  return null;
}
