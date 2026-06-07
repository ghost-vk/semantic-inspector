import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    babel: 'src/stampLocBabel.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  // Keep the consumer's copies; never bundle these in.
  external: ['react', 'react-dom', '@babel/core', 'modern-screenshot', 'vite']
});
