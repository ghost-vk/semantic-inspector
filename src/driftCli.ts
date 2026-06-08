import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { driftCheck } from './driftCheck';
import { applyFix, driftFix } from './driftFix';
import { formatHuman, formatJson } from './driftReport';
import type { DriftResult } from './types';

const USAGE = `semantic-inspector check — detect drift between annotations.json and source

Usage: semantic-inspector check [options]

Options:
  --fix            relock safe (moved) entries and persist
  --json           print the JSON report instead of the human table
  --root <dir>     project root (default: cwd)
  --include <p>    restrict scan to a path prefix under root (repeatable)
  --allow-moved    treat moved as a warning (exit 0)
  --strict         treat unverifiable as drift (exit 1)
  --help           show this help
  --version        print version`;

function version(): string {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function exitCode(result: DriftResult, opts: { allowMoved: boolean; strict: boolean }): number {
  for (const e of result.entries) {
    if (e.verdict === 'missing' || e.verdict === 'ambiguous') return 1;
    if (e.verdict === 'moved' && !opts.allowMoved) return 1;
    if (e.verdict === 'unverifiable' && opts.strict) return 1;
  }
  return 0;
}

/** Parse argv, run the drift pipeline, print, and return an exit code. Never calls process.exit. */
export async function runCli(argv: string[], now: string = new Date().toISOString()): Promise<number> {
  let values: {
    fix?: boolean;
    json?: boolean;
    root?: string;
    include?: string[];
    'allow-moved'?: boolean;
    strict?: boolean;
    help?: boolean;
    version?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        fix: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        root: { type: 'string' },
        include: { type: 'string', multiple: true },
        'allow-moved': { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false }
      }
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    console.error(`semantic-inspector: ${errMessage(e)}`);
    console.error(USAGE);
    return 2;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }
  if (positionals.length > 0 && positionals[0] !== 'check') {
    console.error(`semantic-inspector: unknown command '${positionals[0]}'`);
    console.error(USAGE);
    return 2;
  }

  const root = resolve(values.root ?? process.cwd());
  try {
    let result = driftCheck(root, { include: values.include });
    if (values.fix && result.entries.length > 0) {
      // Relock in place, then recompute the result in memory — no second collect+parse of the tree.
      result = applyFix(result, driftFix(root, result, now));
    }
    console.log(values.json ? formatJson(result) : formatHuman(result));
    return exitCode(result, { allowMoved: Boolean(values['allow-moved']), strict: Boolean(values.strict) });
  } catch (e) {
    console.error(`semantic-inspector: ${errMessage(e)}`);
    return 2;
  }
}
