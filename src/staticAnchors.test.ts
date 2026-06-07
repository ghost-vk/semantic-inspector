import { describe, expect, it } from 'vitest';
import { staticAnchors } from './staticAnchors';

describe('staticAnchors', () => {
  it('extracts loc, comp, literal attrs and text from a host element', () => {
    const src = `
      export function NavItem() {
        return <a data-testid="nav-rubrics" href="/rubrics">Рубрики</a>;
      }
    `;
    const els = staticAnchors('src/NavItem.tsx', src);
    const a = els.find((e) => e.attrs['data-testid'] === 'nav-rubrics');
    expect(a).toBeDefined();
    expect(a?.comp).toBe('NavItem');
    expect(a?.attrs.href).toBe('/rubrics');
    expect(a?.text).toBe('Рубрики');
    expect(a?.loc.startsWith('src/NavItem.tsx:')).toBe(true);
  });

  it('omits dynamic attrs and dynamic text', () => {
    const src = `
      export function Card({ url, label }) {
        return <a href={url}>{label}</a>;
      }
    `;
    const [a] = staticAnchors('src/Card.tsx', src);
    expect(a.attrs.href).toBeUndefined();
    expect(a.text).toBeUndefined();
  });

  it('builds the component path root→leaf across nesting', () => {
    const src = `
      function Sidebar() {
        return <nav><button data-testid="b">x</button></nav>;
      }
    `;
    const btn = staticAnchors('src/Sidebar.tsx', src).find((e) => e.attrs['data-testid'] === 'b');
    expect(btn?.path).toEqual(['Sidebar']);
    expect(btn?.comp).toBe('Sidebar');
  });

  it('only emits host (lowercase) elements, not component tags', () => {
    const src = `
      function App() {
        return <div><NavItem /></div>;
      }
    `;
    const els = staticAnchors('src/App.tsx', src);
    expect(els.every((e) => e.loc.includes('src/App.tsx'))).toBe(true);
    expect(els).toHaveLength(1);
  });

  it('returns [] for a file with no JSX', () => {
    expect(staticAnchors('src/util.ts', 'export const x = 1;')).toEqual([]);
  });

  it('throws on unparseable source', () => {
    expect(() => staticAnchors('src/bad.tsx', 'export function () { return <div>;')).toThrow();
  });

  it('collapses whitespace and caps text at 160 code points', () => {
    const long = 'a'.repeat(200);
    const src = `function F() { return <p>${long}</p>; }`;
    const [p] = staticAnchors('src/F.tsx', src);
    expect(p.text?.endsWith('…')).toBe(true);
    expect([...(p.text ?? '')].length).toBe(161); // 160 + ellipsis
  });
});
