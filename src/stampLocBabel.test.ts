import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';
import { stampLocBabel } from './stampLocBabel';

function compile(code: string, filename = '/repo/packages/ui/src/Foo.tsx', rootDir = '/repo'): string {
  const out = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[stampLocBabel, { rootDir }]]
  });
  return out?.code ?? '';
}

describe('stampLocBabel', () => {
  it('stamps data-loc + data-comp on host elements', () => {
    const out = compile(`export function HeroSection() { return <section><span>hi</span></section>; }`);
    expect(out).toMatch(/data-loc="packages\/ui\/src\/Foo\.tsx:1:\d+"/);
    expect(out).toContain('data-comp="HeroSection"');
  });

  it('resolves component name for arrow components', () => {
    expect(compile(`export const Card = () => <div>x</div>;`)).toContain('data-comp="Card"');
  });

  it('skips PascalCase component elements (no real DOM node)', () => {
    expect(compile(`export function App() { return <Hero />; }`)).not.toContain('data-loc');
  });

  it('is idempotent — does not duplicate existing attributes across two passes', () => {
    const once = compile(`export function A() { return <div>x</div>; }`);
    const twice = compile(once);
    expect(twice.match(/data-loc/g)?.length).toBe(1);
    expect(twice.match(/data-comp/g)?.length).toBe(1);
  });

  it('does not overwrite a hand-authored data-loc', () => {
    const out = compile(`export function A() { return <div data-loc="x" />; }`);
    expect(out.match(/data-loc/g)?.length).toBe(1);
  });

  it('uses POSIX separators and is rootDir-relative', () => {
    const out = compile(`export function B() { return <p>x</p>; }`, '/repo/packages/ui/src/nested/B.tsx');
    expect(out).toMatch(/data-loc="packages\/ui\/src\/nested\/B\.tsx:1:\d+"/);
  });

  it('never leaks an absolute path for files outside rootDir (basename fallback)', () => {
    const out = compile(`export function S() { return <p>x</p>; }`, '/outside/Secret.tsx', '/repo');
    expect(out).toMatch(/data-loc="Secret\.tsx:1:\d+"/);
    expect(out).not.toMatch(/data-loc="\//); // no absolute path
    expect(out).not.toContain('/outside/');
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
