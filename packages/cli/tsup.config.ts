import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  // Fold the workspace packages into the binary. Without this, a global install would
  // carry `@flick/*: "*"` dependencies that resolve to nothing outside the monorepo.
  noExternal: [/^@flick\//],
  banner: { js: '#!/usr/bin/env node' },
});
