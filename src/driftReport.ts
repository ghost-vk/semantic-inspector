import type { DriftEntry, DriftResult, DriftVerdict } from './types';

const MARK: Record<DriftVerdict, string> = {
  resolved: '✓',
  moved: '~',
  missing: '✗',
  ambiguous: '?',
  unverifiable: '·'
};
const LABEL: Record<DriftVerdict, string> = {
  resolved: 'resolved',
  moved: 'moved',
  missing: 'missing',
  ambiguous: 'ambiguous',
  unverifiable: 'unverify'
};

function shortLoc(loc: string | null): string {
  if (!loc) return '—';
  const parts = loc.split(':');
  return parts.length >= 3 ? `:${parts.slice(1).join(':')}` : loc;
}

function detail(e: DriftEntry): string {
  switch (e.verdict) {
    case 'resolved':
      return e.resolvedLoc ?? '';
    case 'moved':
      return `${e.resolvedLoc}  (was ${shortLoc(e.lastSeenLoc)})`;
    case 'missing':
      return `(was ${e.lastSeenLoc ?? '—'})`;
    case 'ambiguous':
      return e.candidates.map((c) => c.loc).join(' · ');
    case 'unverifiable':
      return 'no stable signal — add data-testid';
  }
}

function isFixable(e: DriftEntry): boolean {
  return Boolean(e.resolvedLoc) && e.resolvedLoc !== e.lastSeenLoc;
}

export function formatHuman(result: DriftResult): string {
  const total = result.entries.length;
  if (total === 0) return 'semantic-inspector: no annotations found.';

  const lines: string[] = [
    `semantic-inspector drift — ${total} annotation${total === 1 ? '' : 's'}, ${result.drifted} drifted`,
    ''
  ];
  for (const e of result.entries) {
    lines.push(`  ${MARK[e.verdict]} ${LABEL[e.verdict].padEnd(10)} ${e.name.padEnd(14)} ${detail(e)}`);
  }
  lines.push('');
  const fixable = result.entries.filter(isFixable).length;
  const tail = fixable ? ` (${fixable} fixable). Run --fix to relock.` : '.';
  lines.push(`${result.drifted} drifted${tail}`);
  return lines.join('\n');
}

export function formatJson(result: DriftResult): string {
  return JSON.stringify({ drifted: result.drifted, ok: result.ok, entries: result.entries }, null, 2);
}
