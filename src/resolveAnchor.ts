import type { AnnotationAnchor, AnnotationLastSeen, DriftEntry, StaticElement } from './types';

const STRONG = ['data-testid', 'id', 'href', 'name'] as const;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function textMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Is `needle` an ordered subsequence of `hay`? Both are root→leaf component chains. */
function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) {
    if (i < needle.length && h === needle[i]) i++;
  }
  return i === needle.length;
}

function strongMatch(anchor: AnnotationAnchor, el: StaticElement): boolean {
  const aa = anchor.attrs ?? {};
  return STRONG.some((k) => Boolean(aa[k]) && el.attrs[k] === aa[k]);
}

/** A candidate counts only with a strong id signal, or with comp AND text together. */
function meetsThreshold(anchor: AnnotationAnchor, el: StaticElement): boolean {
  if (strongMatch(anchor, el)) return true;
  return Boolean(anchor.comp && el.comp === anchor.comp && anchor.text && el.text && textMatch(anchor.text, el.text));
}

/** Can the anchor be checked statically at all? Needs a strong literal attr or some text. */
function verifiable(anchor: AnnotationAnchor): boolean {
  const aa = anchor.attrs ?? {};
  return STRONG.some((k) => Boolean(aa[k])) || Boolean(anchor.text);
}

function score(anchor: AnnotationAnchor, el: StaticElement): number {
  const aa = anchor.attrs ?? {};
  let s = 0;
  if (aa['data-testid'] && el.attrs['data-testid'] === aa['data-testid']) s += 100;
  if (aa.id && el.attrs.id === aa.id) s += 60;
  if (aa.href && el.attrs.href === aa.href) s += 50;
  if (aa.name && el.attrs.name === aa.name) s += 50;
  if (anchor.comp && el.comp === anchor.comp) s += 20;
  if (anchor.text && el.text && textMatch(anchor.text, el.text)) s += 15;
  if (anchor.path?.length && el.path.length && isSubsequence(anchor.path, el.path)) s += 10;
  if (aa.type && el.attrs.type === aa.type) s += 5;
  return s;
}

export function resolveAnchor(
  name: string,
  anchor: AnnotationAnchor,
  lastSeen: AnnotationLastSeen,
  elements: StaticElement[]
): DriftEntry {
  const base = {
    name,
    lastSeenLoc: lastSeen.loc,
    resolvedLoc: null as string | null,
    candidates: [] as { loc: string; score: number }[]
  };

  if (!verifiable(anchor)) return { ...base, verdict: 'unverifiable' };

  const scored = elements
    .filter((el) => meetsThreshold(anchor, el))
    .map((el) => ({ loc: el.loc, score: score(anchor, el) }))
    .sort((a, b) => b.score - a.score || (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

  if (scored.length === 0) return { ...base, verdict: 'missing' };

  const top = scored[0];
  if (scored.length > 1 && scored[1].score === top.score) {
    return { ...base, verdict: 'ambiguous', candidates: scored.filter((c) => c.score === top.score) };
  }

  const candidates = [top];
  if (lastSeen.loc != null && top.loc !== lastSeen.loc) {
    return { ...base, verdict: 'moved', resolvedLoc: top.loc, candidates };
  }
  return { ...base, verdict: 'resolved', resolvedLoc: top.loc, candidates };
}
