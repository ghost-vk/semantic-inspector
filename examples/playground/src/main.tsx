import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SemanticInspector } from 'semantic-inspector';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <App />
    {/*
      A real app should gate this behind a dev flag and lazy-load it, e.g.
        {import.meta.env.DEV && <Suspense fallback={null}><LazyInspector annotate /></Suspense>}
      The playground mounts it directly because it is itself a dev tool.
    */}
    <SemanticInspector
      annotate
      onCopy={(kind, payload) => console.log('[playground] copied', kind, payload)}
      onAnnotate={(annotation) => console.log('[playground] annotated', annotation)}
    />
  </StrictMode>
);
