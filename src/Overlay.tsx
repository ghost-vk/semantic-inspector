import type { CSSProperties } from 'react';
import type { InspectTarget } from './types';

const Z = 2147483600;

const badge: CSSProperties = {
  position: 'fixed',
  bottom: 12,
  left: 12,
  zIndex: Z + 2,
  padding: '6px 10px',
  borderRadius: 6,
  font: '12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
  background: 'rgba(17,17,17,0.92)',
  color: '#fff',
  pointerEvents: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
};

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 12,
  right: 12,
  zIndex: Z + 2,
  padding: '6px 10px',
  borderRadius: 6,
  font: '12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
  background: 'rgba(22,101,52,0.95)',
  color: '#fff',
  pointerEvents: 'none',
  maxWidth: '60vw',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

function boxStyle(r: DOMRect): CSSProperties {
  return {
    position: 'fixed',
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    zIndex: Z,
    outline: '2px solid #6366f1',
    background: 'rgba(99,102,241,0.12)',
    pointerEvents: 'none',
    transition: 'all 60ms ease-out'
  };
}

function tipStyle(r: DOMRect): CSSProperties {
  const top = r.top > 26 ? r.top - 24 : r.bottom + 4;
  return {
    position: 'fixed',
    left: r.left,
    top,
    zIndex: Z + 1,
    padding: '2px 6px',
    borderRadius: 4,
    font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    background: '#6366f1',
    color: '#fff',
    pointerEvents: 'none',
    whiteSpace: 'nowrap'
  };
}

export function Overlay({ target, toast }: { target: InspectTarget | null; toast: string | null }) {
  return (
    <>
      <div style={badge}>⌖ inspect · click=name · ⇧click=shot · Esc=exit</div>
      {target && (
        <>
          <div style={boxStyle(target.rect)} />
          <div style={tipStyle(target.rect)}>
            {target.comp}
            <span style={{ opacity: 0.75 }}> · {target.loc ?? 'no source'}</span>
          </div>
        </>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </>
  );
}
