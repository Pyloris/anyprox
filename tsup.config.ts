import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    shims: true,
    target: 'node20',
  },
  {
    entry: ['bin/anyprox.ts'],
    format: ['esm'],
    outDir: 'dist/bin',
    banner: {
      js: '#!/usr/bin/env node',
    },
    sourcemap: true,
    target: 'node20',
  },
]);
