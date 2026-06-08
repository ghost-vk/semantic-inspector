import type { AnnotationAnchor, AnnotationLastSeen, DriftEntry, DriftVerdict, StaticElement } from './types';

const STRONG = ['data-testid', 'id', 'href', 'name'] as const;

/** Verdicts that count as drift (and gate CI). `resolved` and `unverifiable` are not drift. */
const DRIFT_VERDICTS = new Set<DriftVerdict>(['moved', 'missing', 'ambiguous']);

/** Single source of truth for "does this verdict count as drift". Consumed by driftCheck + applyFix. */
export function isDrift(verdict: DriftVerdict): boolean {
  return DRIFT_VERDICTS.has(verdict);
}

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

/**
 * An index over the static elements for fast candidate lookup. Each element is bucketed under every
 * STRONG attribute value it carries and under its component name. `candidatesFor` then unions only
 * the buckets an anchor could possibly match — a *superset* of the elements that pass meetsThreshold
 * — so indexed resolution is verdict-identical to scanning the whole array, but O(candidates) per
 * anchor instead of O(elements). Without it the resolver is O(annotations · elements).
 */
export interface ElementIndex {
  byAttr: Record<(typeof STRONG)[number], Map<string, StaticElement[]>>;
  byComp: Map<string, StaticElement[]>;
}

function pushBucket(map: Map<string, StaticElement[]>, key: string, el: StaticElement): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(el);
  else map.set(key, [el]);
}

export function buildElementIndex(elements: StaticElement[]): ElementIndex {
  const byAttr = {
    'data-testid': new Map<string, StaticElement[]>(),
    id: new Map<string, StaticElement[]>(),
    href: new Map<string, StaticElement[]>(),
    name: new Map<string, StaticElement[]>()
  };
  const byComp = new Map<string, StaticElement[]>();
  for (const el of elements) {
    for (const k of STRONG) {
      const v = el.attrs[k];
      if (v != null) pushBucket(byAttr[k], v, el);
    }
    if (el.comp) pushBucket(byComp, el.comp, el);
  }
  return { byAttr, byComp };
}

/** Union of the index buckets an anchor could match, de-duplicated (an element may be in several). */
function candidatesFor(index: ElementIndex, anchor: AnnotationAnchor): StaticElement[] {
  const seen = new Set<StaticElement>();
  const out: StaticElement[] = [];
  const add = (els: StaticElement[] | undefined): void => {
    if (!els) return;
    for (const el of els) {
      if (!seen.has(el)) {
        seen.add(el);
        out.push(el);
      }
    }
  };
  const aa = anchor.attrs ?? {};
  for (const k of STRONG) {
    const v = aa[k];
    if (v) add(index.byAttr[k].get(v));
  }
  // The comp+text threshold branch can only fire when both are present on the anchor.
  if (anchor.comp && anchor.text) add(index.byComp.get(anchor.comp));
  return out;
}

/**
 * Score the candidate elements and pick a verdict. `candidates` may be the whole element array
 * (resolveAnchor) or an index-narrowed superset (resolveAnchorIndexed); the meetsThreshold filter
 * inside makes both paths produce the same verdict.
 */
function decide(
  name: string,
  anchor: AnnotationAnchor,
  lastSeen: AnnotationLastSeen,
  candidates: StaticElement[]
): DriftEntry {
  const base = {
    name,
    lastSeenLoc: lastSeen.loc,
    resolvedLoc: null as string | null,
    candidates: [] as { loc: string; score: number }[]
  };

  if (!verifiable(anchor)) return { ...base, verdict: 'unverifiable' };

  const scored = candidates
    .filter((el) => meetsThreshold(anchor, el))
    .map((el) => ({ loc: el.loc, score: score(anchor, el) }))
    .sort((a, b) => b.score - a.score || (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

  if (scored.length === 0) {
    // Candidates exist but none passed meetsThreshold. If every candidate lacks static text
    // (dynamic content via props) and the anchor matched only on comp+text, the mismatch is a
    // static-analysis limitation, not a real disappearance — report unverifiable, not missing.
    const allDynamic = candidates.length > 0 && candidates.every((el) => !el.text);
    return { ...base, verdict: allDynamic ? 'unverifiable' : 'missing' };
  }

  const top = scored[0];
  if (scored.length > 1 && scored[1].score === top.score) {
    return { ...base, verdict: 'ambiguous', candidates: scored.filter((c) => c.score === top.score) };
  }

  const candidatesOut = [top];
  if (lastSeen.loc != null && top.loc !== lastSeen.loc) {
    return { ...base, verdict: 'moved', resolvedLoc: top.loc, candidates: candidatesOut };
  }
  return { ...base, verdict: 'resolved', resolvedLoc: top.loc, candidates: candidatesOut };
}

/** Resolve an anchor by scanning the full element array. Pure reference path used by unit tests. */
export function resolveAnchor(
  name: string,
  anchor: AnnotationAnchor,
  lastSeen: AnnotationLastSeen,
  elements: StaticElement[]
): DriftEntry {
  return decide(name, anchor, lastSeen, elements);
}

/** Resolve an anchor using a prebuilt index. Verdict-identical to resolveAnchor; the production path. */
export function resolveAnchorIndexed(
  name: string,
  anchor: AnnotationAnchor,
  lastSeen: AnnotationLastSeen,
  index: ElementIndex
): DriftEntry {
  return decide(name, anchor, lastSeen, candidatesFor(index, anchor));
}
