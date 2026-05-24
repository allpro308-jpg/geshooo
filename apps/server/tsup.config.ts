import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/scripts/create-admin.ts', 'src/scripts/setup-status.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  bundle: true,
  noExternal: [/(.*)/], // bundle everything except node builtins to resolve alias paths
  external: ['better-sqlite3', 'express', 'cors', 'zod', 'ws'], // keep native/large deps external
  splitting: false,
});
