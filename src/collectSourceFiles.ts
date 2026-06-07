import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const EXTS = new Set(['.jsx', '.tsx', '.js', '.ts']);
const SKIP_DIRS = new Set(['node_modules', 'dist']);

function isSource(name: string): boolean {
  if (!EXTS.has(extname(name))) return false;
  if (name.endsWith('.d.ts')) return false;
  if (/\.test\.[jt]sx?$/.test(name)) return false;
  return true;
}

// readdirSync has typed overloads; an explicit annotation (e.g. ReturnType<typeof readdirSync>)
// resolves to the Buffer variant and breaks string ops. Leave this helper UN-annotated so TS
// infers Dirent<string>[].
function readEntries(absDir: string) {
  try {
    return readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Recursively collect source files under `root`, returning relative POSIX paths. Skips
 * node_modules/dist, dotdirs (.git, .semantic-inspector), test files and .d.ts. When `include`
 * is given, only files whose relative path starts with one of the prefixes are returned.
 */
export function collectSourceFiles(root: string, include?: string[]): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const e of readEntries(absDir)) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(join(absDir, e.name), rel);
      } else if (e.isFile() && isSource(e.name)) {
        if (!include?.length || include.some((p) => rel === p || rel.startsWith(`${p}/`))) out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}
