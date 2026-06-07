import { transformAsync } from '@babel/core';
import type { Plugin } from 'vite';
import { type StampLocOptions, stampLocBabel } from './stampLocBabel';

export interface StampLocViteOptions extends StampLocOptions {
  /** Which files to stamp. Default /\.[jt]sx$/. */
  include?: RegExp;
}

/**
 * Vite plugin: stamps data-loc/data-comp onto JSX host elements.
 *
 * `@vitejs/plugin-react` v6 transpiles via oxc (no Babel hook), so the attributes are added in
 * a separate pre-pass (Babel parse + our plugin only; JSX/TS are preserved) and oxc does the
 * rest. It runs only on the dev server (`apply: 'serve'`) so stamps never reach a prod build.
 *
 * A parse error in a single file does not fail the build — that file is simply left unstamped
 * (warning in the console).
 */
export function stampLocVite(opts: StampLocViteOptions = {}): Plugin {
  const include = opts.include ?? /\.[jt]sx$/;
  const babelOpts: StampLocOptions = {
    attrLoc: opts.attrLoc,
    attrComp: opts.attrComp,
    rootDir: opts.rootDir
  };

  return {
    name: 'semantic-inspector:stamp-loc',
    enforce: 'pre',
    apply: 'serve',
    async transform(code, id) {
      const file = id.split('?')[0];
      if (!include.test(file) || file.includes('/node_modules/')) return null;
      if (!code.includes('<')) return null; // no JSX tags → nothing to stamp; skip the Babel parse

      try {
        const result = await transformAsync(code, {
          filename: file,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          parserOpts: { plugins: ['jsx', 'typescript'] },
          plugins: [[stampLocBabel, babelOpts]]
        });
        if (!result?.code) return null;
        return { code: result.code, map: result.map ?? null };
      } catch (err) {
        this.warn(`stamp-loc skipped ${file}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
  };
}
