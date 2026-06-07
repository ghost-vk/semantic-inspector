import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Imported from live source (not the built dist), so editing src/* hot-reloads here.
import { stampLocVite } from '../../src/vite';

const root = import.meta.dirname;

// https://vitejs.dev/config/
export default defineConfig({
  root,
  plugins: [
    // Stamp this app's JSX with data-loc/data-comp and mount the annotate endpoint.
    // rootDir scopes data-loc paths and the .semantic-inspector/ output to the playground.
    stampLocVite({ rootDir: root }),
    react()
  ],
  resolve: {
    alias: {
      // Order matters: the more specific subpath entry must precede the bare package entry.
      'semantic-inspector/vite': resolve(root, '../../src/vite.ts'),
      'semantic-inspector': resolve(root, '../../src/index.ts')
    }
  }
});
