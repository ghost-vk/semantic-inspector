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
  describe('apply gating (serve vs build)', () => {
    it('defaults to serve-only so stamps never reach a prod build', () => {
      expect(stampLocVite().apply).toBe('serve');
      expect(stampLocVite({ applyOnBuild: false }).apply).toBe('serve');
    });
    it('applyOnBuild:true → apply:undefined (runs in serve + build)', () => {
      expect(stampLocVite({ applyOnBuild: true }).apply).toBeUndefined();
    });
    it('enforce stays pre in both modes', () => {
      expect(stampLocVite({ applyOnBuild: true }).enforce).toBe('pre');
    });
    it('configureServer always present (Vite only calls it on dev server, not in build)', () => {
      expect(typeof stampLocVite({ applyOnBuild: true }).configureServer).toBe('function');
    });
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

  it('mounts an annotations middleware on the dev server', () => {
    const plugin = stampLocVite();
    const used: unknown[] = [];
    const server = { middlewares: { use: (fn: unknown) => used.push(fn) } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal ViteDevServer double
    (plugin.configureServer as (s: any) => void)(server as any);
    expect(used).toHaveLength(1);
    expect(typeof used[0]).toBe('function');
  });
});
