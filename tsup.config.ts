import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    babel: 'src/stampLocBabel.ts',
    cli: 'src/cli.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  sourcemap: true,
  // Browser- and Node-20-safe; keep in lock-step with tsconfig `target` / engines floor.
  target: 'es2021',
  // Keep the consumer's copies; never bundle these in.
  external: ['react', 'react-dom', '@babel/core', 'modern-screenshot', 'vite']
});
