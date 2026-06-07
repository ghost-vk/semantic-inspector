import { useEffect, useMemo, useRef, useState } from 'react';
import { copyElementShot, copyText } from './clipboard';
import { extractSemantics } from './extractSemantics';
import { resolveTarget } from './resolveTarget';
import type {
  CopyKind,
  InspectTarget,
  LocInfo,
  SemanticInfo,
  SemanticInspectorProps,
  UseInspectorResult
} from './types';

const DEFAULT_HOTKEY = 'Alt+Shift+S';

function defaultFormat(t: LocInfo): string {
  return t.loc ? `${t.comp} — ${t.loc}` : t.comp;
}

// data-testid reads better as "testid"; other whitelisted attrs use their own name.
function attrLabel(name: string): string {
  return name === 'data-testid' ? 'testid' : name;
}

function semanticFormat(t: SemanticInfo): string {
  const lines = [t.loc ? `${t.comp} — ${t.loc}` : t.comp];
  if (t.text) lines.push(`text: "${t.text}"`);
  if (t.index && t.total) lines.push(`index: ${t.index}/${t.total}`);
  if (t.path?.length) lines.push(`path: ${t.path.join(' › ')}`);
  if (t.attrs) {
    for (const [k, v] of Object.entries(t.attrs)) lines.push(`${attrLabel(k)}: ${v}`);
  }
  return lines.join('\n');
}

interface Hotkey {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  key: string;
}

/** Parse 'Alt+Shift+S' into a descriptor. The final token is the key (empty → literal '+'). */
function parseHotkey(hotkey: string): Hotkey {
  const parts = hotkey.split('+').map((p) => p.trim().toLowerCase());
  const has = (...names: string[]): boolean => names.some((n) => parts.includes(n));
  const last = parts[parts.length - 1];
  return {
    alt: has('alt'),
    shift: has('shift'),
    ctrl: has('ctrl', 'control'),
    meta: has('meta', 'cmd'),
    key: last === '' ? '+' : last
  };
}

// Physical-key codes whose token differs from the produced character, so a hotkey written with
// the unshifted glyph still matches when Shift transforms it (e.g. Ctrl+Shift+/ → e.key '?').
const CODE_TO_KEY: Record<string, string> = {
  slash: '/',
  backslash: '\\',
  period: '.',
  comma: ',',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equal: '='
};

/** Whether a keydown event matches the parsed hotkey. */
function matchHotkey(e: KeyboardEvent, hk: Hotkey): boolean {
  if (e.altKey !== hk.alt || e.shiftKey !== hk.shift || e.ctrlKey !== hk.ctrl || e.metaKey !== hk.meta) {
    return false;
  }
  // Normalize the physical code (KeyA → a, Digit1 → 1, Slash → /) so non-letter keys match too.
  const rawCode = e.code.toLowerCase();
  const code = CODE_TO_KEY[rawCode] ?? rawCode.replace(/^(key|digit)/, '');
  return e.key.toLowerCase() === hk.key || code === hk.key;
}

function sameTarget(a: InspectTarget | null, b: InspectTarget | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.el === b.el &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

/**
 * Inspection-mode state + listeners.
 * - keydown: the hotkey toggles `active`; Esc exits.
 * - active: mousemove (rAF-coalesced) updates `target`; click (capture, preventDefault) copies
 *   text, Shift+click copies an element screenshot.
 */
export function useInspector(opts: SemanticInspectorProps = {}): UseInspectorResult {
  const { hotkey = DEFAULT_HOTKEY } = opts;
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<InspectTarget | null>(null);

  // Fresh callbacks without re-subscribing listeners.
  const cbRef = useRef<SemanticInspectorProps>(opts);
  cbRef.current = opts;

  // Latest hovered target, so the click handler copies exactly what is highlighted.
  const targetRef = useRef<InspectTarget | null>(null);

  const hk = useMemo(() => parseHotkey(hotkey), [hotkey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (matchHotkey(e, hk)) {
        e.preventDefault();
        setActive((a) => !a);
      } else if (e.key === 'Escape') {
        setActive((a) => (a ? false : a));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hk]);

  useEffect(() => {
    if (!active) {
      targetRef.current = null;
      setTarget(null);
      return;
    }

    let rafId = 0;
    let lastX = 0;
    let lastY = 0;
    let shotInFlight = false;

    function onMove(e: MouseEvent): void {
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafId) return; // one update per frame, regardless of input rate
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const next = resolveTarget(document.elementFromPoint(lastX, lastY));
        targetRef.current = next;
        setTarget((prev) => (sameTarget(prev, next) ? prev : next));
      });
    }

    function onClick(e: MouseEvent): void {
      const t = targetRef.current ?? resolveTarget(document.elementFromPoint(e.clientX, e.clientY));
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const { formatText, onCopy, onError, semantic = false } = cbRef.current;
      const done = (kind: CopyKind, payload: string): void => onCopy?.(kind, payload);
      const fail = (kind: CopyKind, err: unknown): void => {
        if (onError) onError(kind, err);
        // Surface failures even without an onError handler (console is the right channel for a dev tool).
        else console.warn(`[semantic-inspector] ${kind} copy failed:`, err);
      };

      if (e.shiftKey) {
        if (shotInFlight) return; // ignore overlapping captures
        shotInFlight = true;
        copyElementShot(t.el)
          .then(
            () => done('screenshot', t.comp),
            (err: unknown) => fail('screenshot', err)
          )
          .finally(() => {
            shotInFlight = false;
          });
      } else {
        const info: SemanticInfo = semantic ? extractSemantics(t.el) : { comp: t.comp, loc: t.loc };
        const fmt: (i: SemanticInfo) => string = formatText ?? (semantic ? semanticFormat : defaultFormat);
        const text = fmt(info);
        copyText(text).then(
          () => done('text', text),
          (err: unknown) => fail('text', err)
        );
      }
    }

    window.addEventListener('mousemove', onMove, { capture: true, passive: true });
    window.addEventListener('click', onClick, true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      if (rafId) cancelAnimationFrame(rafId);
      document.body.style.cursor = prevCursor;
    };
  }, [active]);

  return { active, target };
}
