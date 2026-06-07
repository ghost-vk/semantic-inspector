import { describe, expect, it, vi } from 'vitest';
import { stampLocVite } from './vite';

type TransformResult = { code: string; map: unknown } | null;
type TransformCtx = { warn: (msg: string) => void };
type TransformFn = (this: TransformCtx, code: string, id: string) => Promise<TransformResult>;

function getTransform(): TransformFn {
  const plugin = stampLocVite();
  return plugin.transform as unknown as TransformFn;
}

describe('stampLocVite', () => {
  it('declares itself as a dev-server, pre-enforced plugin', () => {
    const plugin = stampLocVite();
    expect(plugin.enforce).toBe('pre');
    expect(plugin.apply).toBe('serve');
  });

  it('skips node_modules and non-jsx files', async () => {
    const ctx: TransformCtx = { warn: vi.fn() };
    const transform = getTransform();
    expect(await transform.call(ctx, '<div/>', '/a/node_modules/b.tsx')).toBeNull();
    expect(await transform.call(ctx, 'const x = 1', '/a/b.ts')).toBeNull();
  });

  it('skips files with no JSX tags', async () => {
    const ctx: TransformCtx = { warn: vi.fn() };
    expect(await getTransform().call(ctx, 'export const x = 1;', '/a/B.tsx')).toBeNull();
  });

  it('stamps a .tsx file and strips the query string', async () => {
    const ctx: TransformCtx = { warn: vi.fn() };
    const out = await getTransform().call(ctx, 'export function A(){return <div/>;}', '/a/B.tsx?t=1');
    expect(out?.code).toContain('data-loc');
  });

  it('warns and returns null on a parse error (build not broken)', async () => {
    const ctx: TransformCtx = { warn: vi.fn() };
    const out = await getTransform().call(ctx, 'export const = <broken', '/a/B.tsx');
    expect(out).toBeNull();
    expect(ctx.warn).toHaveBeenCalled();
  });
});
