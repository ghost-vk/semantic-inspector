import { afterEach, describe, expect, it } from 'vitest';
import { resolveComp, resolveTarget } from './resolveTarget';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveTarget', () => {
  it('reads data-loc/data-comp from nearest stamped ancestor', () => {
    document.body.innerHTML = `<section data-loc="src/Foo.tsx:3:1" data-comp="Foo"><span id="s">x</span></section>`;
    const t = resolveTarget(document.getElementById('s'));
    expect(t?.comp).toBe('Foo');
    expect(t?.loc).toBe('src/Foo.tsx:3:1');
    expect(t?.el.tagName.toLowerCase()).toBe('section');
  });

  it('falls back to the React fiber component name when data-comp is absent', () => {
    document.body.innerHTML = `<div id="f" data-loc="src/W.tsx:1:1"></div>`;
    const el = document.getElementById('f');
    (el as unknown as Record<string, unknown>).__reactFiber$test = { type: { name: 'Widget' }, return: null };
    expect(resolveTarget(el)?.comp).toBe('Widget');
  });

  it('falls back to filename base when data-comp absent', () => {
    document.body.innerHTML = `<div id="d" data-loc="src/widgets/Card.tsx:9:1"></div>`;
    expect(resolveTarget(document.getElementById('d'))?.comp).toBe('Card');
  });

  it('falls back to tag name and null loc when nothing stamped', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const t = resolveTarget(document.getElementById('b'));
    expect(t?.comp).toBe('button');
    expect(t?.loc).toBeNull();
  });

  it('returns null for null input', () => {
    expect(resolveTarget(null)).toBeNull();
  });

  it('resolveComp reads data-comp directly from the given element', () => {
    document.body.innerHTML = `<button id="b" data-comp="NavItem">x</button>`;
    expect(resolveComp(document.getElementById('b') as Element)).toBe('NavItem');
  });

  it('resolveComp falls back to the tag name when nothing is stamped', () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    expect(resolveComp(document.getElementById('b') as Element)).toBe('button');
  });
});
