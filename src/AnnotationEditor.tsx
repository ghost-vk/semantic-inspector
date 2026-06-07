import { type CSSProperties, type JSX, type KeyboardEvent, useState } from 'react';
import type { InspectTarget } from './types';

// Above the overlay highlight/tip, below the toast band (see Overlay.tsx Z layering).
const Z = 2147483640;

interface AnnotationEditorProps {
  target: InspectTarget;
  error?: string | null;
  onSubmit: (name: string, tags: string[], note: string) => void;
  onCancel: () => void;
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function panelStyle(r: DOMRect): CSSProperties {
  const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 180));
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 280));
  return {
    position: 'fixed',
    top,
    left,
    zIndex: Z,
    width: 260,
    padding: 10,
    borderRadius: 8,
    background: 'rgba(17,17,17,0.97)',
    color: '#fff',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  };
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #444',
  background: '#222',
  color: '#fff',
  font: 'inherit'
};

export function AnnotationEditor({ target, error, onSubmit, onCancel }: AnnotationEditorProps): JSX.Element {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');

  const submit = (): void => {
    if (!name.trim()) return;
    onSubmit(name.trim(), parseTags(tags), note);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // Stop propagation so the inspector's window-level Esc/hotkey handlers don't also fire.
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dev-tool overlay form, key handling is scoped here
    <div style={panelStyle(target.rect)} onKeyDown={onKeyDown}>
      <div style={{ opacity: 0.7 }}>annotate · {target.comp}</div>
      <input
        // biome-ignore lint/a11y/noAutofocus: inline dev-tool editor, immediate focus is the intended UX
        autoFocus
        aria-label="annotation name"
        placeholder="name (e.g. пилюля)"
        style={inputStyle}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="annotation tags"
        placeholder="tags, comma separated"
        style={inputStyle}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <input
        aria-label="annotation note"
        placeholder="note (optional)"
        style={inputStyle}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" style={{ font: 'inherit' }} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" style={{ font: 'inherit' }} onClick={submit}>
          Save
        </button>
      </div>
    </div>
  );
}
