import type { InspectTarget } from './types';

const LOC_ATTR = 'data-loc';
const COMP_ATTR = 'data-comp';

/**
 * DOM-элемент под курсором → цель инспекции.
 * Идём к ближайшему предку с data-loc (заштампован babel-плагином). Если его нет
 * (prod-билд без штампов / сторонний узел) — best-effort: имя из React fiber,
 * затем имя файла из data-loc, затем имя тега.
 */
export function resolveTarget(el: Element | null): InspectTarget | null {
  if (!el) return null;
  const target = el.closest(`[${LOC_ATTR}]`) ?? el;
  const loc = target.getAttribute(LOC_ATTR);
  const comp = target.getAttribute(COMP_ATTR) ?? fiberName(target) ?? fallbackName(target, loc);
  return { comp, loc, el: target, rect: target.getBoundingClientRect() };
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

// React-internals fallback. _debugSource убран в React 19, но имя компонента из
// fiber.type всё ещё доступно (в dev-билде не минифицировано).
interface FiberLike {
  type: { displayName?: string; name?: string } | string | null | undefined;
  return: FiberLike | null;
}

function fiberName(el: Element): string | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!key) return null;
  let fiber = (el as unknown as Record<string, FiberLike | undefined>)[key] ?? null;
  while (fiber) {
    const t = fiber.type;
    const name = t && typeof t !== 'string' ? (t.displayName ?? t.name) : undefined;
    if (name && /^[A-Z]/.test(name)) return name;
    fiber = fiber.return;
  }
  return null;
}
