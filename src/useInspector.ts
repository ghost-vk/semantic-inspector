import { useEffect, useRef, useState } from 'react';
import { copyElementShot, copyText } from './clipboard';
import { resolveTarget } from './resolveTarget';
import type { CopyKind, InspectTarget, SemanticInspectorProps } from './types';

const DEFAULT_HOTKEY = 'Alt+Shift+S';

function defaultFormat(t: { comp: string; loc: string | null }): string {
  return t.loc ? `${t.comp} — ${t.loc}` : t.comp;
}

/** 'Alt+Shift+S' → совпадает ли событие keydown. Последний токен — клавиша. */
function matchHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const want = (m: string, alt?: string) => parts.includes(m) || (alt ? parts.includes(alt) : false);
  if (e.altKey !== want('alt')) return false;
  if (e.shiftKey !== want('shift')) return false;
  if (e.ctrlKey !== want('ctrl', 'control')) return false;
  if (e.metaKey !== want('meta', 'cmd')) return false;
  return e.key.toLowerCase() === key || e.code.toLowerCase() === `key${key}`;
}

/**
 * Состояние режима инспекции + слушатели.
 * - keydown: хоткей переключает active, Esc выключает.
 * - active: mousemove обновляет target; click (capture, preventDefault) копирует
 *   текст, Shift+click — скриншот элемента.
 */
export function useInspector(opts: SemanticInspectorProps = {}) {
  const { hotkey = DEFAULT_HOTKEY } = opts;
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<InspectTarget | null>(null);

  // Свежие колбэки без переподписки слушателей.
  const cbRef = useRef<SemanticInspectorProps>(opts);
  cbRef.current = opts;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (matchHotkey(e, hotkey)) {
        e.preventDefault();
        setActive((a) => !a);
      } else if (e.key === 'Escape') {
        setActive(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [hotkey]);

  useEffect(() => {
    if (!active) {
      setTarget(null);
      return;
    }

    function onMove(e: MouseEvent) {
      setTarget(resolveTarget(document.elementFromPoint(e.clientX, e.clientY)));
    }

    function onClick(e: MouseEvent) {
      const t = resolveTarget(document.elementFromPoint(e.clientX, e.clientY));
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const { formatText = defaultFormat, onCopy, onError } = cbRef.current;
      const done = (kind: CopyKind, payload: string) => {
        onCopy?.(kind, payload);
      };
      const fail = (kind: CopyKind, err: unknown) => {
        onError?.(kind, err);
      };
      if (e.shiftKey) {
        copyElementShot(t.el).then(
          () => {
            done('screenshot', t.comp);
          },
          (err: unknown) => {
            fail('screenshot', err);
          }
        );
      } else {
        const text = formatText({ comp: t.comp, loc: t.loc });
        copyText(text).then(
          () => {
            done('text', text);
          },
          (err: unknown) => {
            fail('text', err);
          }
        );
      }
    }

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      document.body.style.cursor = prevCursor;
    };
  }, [active]);

  return { active, target };
}
