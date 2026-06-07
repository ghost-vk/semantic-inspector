import { afterEach, describe, expect, it } from 'vitest';
import { resolveTarget } from './resolveTarget';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveTarget', () => {
  it('reads data-loc/data-comp from nearest stamped ancestor', () => {
    document.body.innerHTML = `<section data-loc="src/Foo.tsx:3" data-comp="Foo"><span id="s">x</span></section>`;
    const t = resolveTarget(document.getElementById('s'));
    expect(t?.comp).toBe('Foo');
    expect(t?.loc).toBe('src/Foo.tsx:3');
    expect(t?.el.tagName.toLowerCase()).toBe('section');
  });

  it('falls back to filename base when data-comp absent', () => {
    document.body.innerHTML = `<div id="d" data-loc="src/widgets/Card.tsx:9"></div>`;
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
});
