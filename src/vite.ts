import { transformAsync } from '@babel/core';
import type { Plugin } from 'vite';
import stampLocBabel, { type StampLocOptions } from './stampLocBabel';

export interface StampLocViteOptions extends StampLocOptions {
  /** Какие файлы штамповать. Default /\.[jt]sx$/. */
  include?: RegExp;
}

/**
 * Vite-плагин: штампует data-loc/data-comp на JSX host-элементы.
 *
 * `@vitejs/plugin-react` v6 транспилит через oxc (без babel-хука), поэтому
 * атрибуты добавляем отдельным pre-проходом babel'а (только парсинг + наш
 * плагин, JSX/TS сохраняются), а oxc уже делает остальное.
 *
 * Парс-ошибка в отдельном файле не валит сборку — файл просто остаётся без
 * штампов (warn в консоль).
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
    async transform(code, id) {
      const file = id.split('?')[0];
      if (!include.test(file) || file.includes('/node_modules/')) return null;

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
        return { code: result.code, map: result.map };
      } catch (err) {
        this.warn(`stamp-loc skipped ${file}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
  };
}
