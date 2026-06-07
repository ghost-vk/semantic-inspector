import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';
import stampLocBabel from './stampLocBabel';

function compile(code: string, filename = '/repo/packages/ui/src/Foo.tsx'): string {
  const out = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[stampLocBabel, { rootDir: '/repo' }]]
  });
  return out?.code ?? '';
}

describe('stampLocBabel', () => {
  it('stamps data-loc + data-comp on host elements', () => {
    const out = compile(`export function HeroSection() { return <section><span>hi</span></section>; }`);
    expect(out).toContain('data-loc="packages/ui/src/Foo.tsx:1"');
    expect(out).toContain('data-comp="HeroSection"');
  });

  it('resolves component name for arrow components', () => {
    expect(compile(`export const Card = () => <div>x</div>;`)).toContain('data-comp="Card"');
  });

  it('skips PascalCase component elements (no real DOM node)', () => {
    expect(compile(`export function App() { return <Hero />; }`)).not.toContain('data-loc');
  });

  it('is idempotent — does not duplicate an existing attribute', () => {
    const out = compile(`export function A() { return <div data-loc="x" />; }`);
    expect(out.match(/data-loc/g)?.length).toBe(1);
  });

  it('uses POSIX separators and is rootDir-relative', () => {
    const out = compile(`export function B() { return <p>x</p>; }`, '/repo/packages/ui/src/nested/B.tsx');
    expect(out).toContain('data-loc="packages/ui/src/nested/B.tsx:1"');
  });

  it('respects custom attribute names', () => {
    const out = transformSync(`export function C() { return <i/>; }`, {
      filename: '/repo/x.tsx',
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx', 'typescript'] },
      plugins: [[stampLocBabel, { rootDir: '/repo', attrLoc: 'data-x', attrComp: 'data-c' }]]
    })?.code;
    expect(out).toContain('data-x=');
    expect(out).toContain('data-c="C"');
  });
});
