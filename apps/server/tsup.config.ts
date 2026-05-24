import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/scripts/create-admin.ts', 'src/scripts/setup-status.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  bundle: true,
  // Bundle workspace packages and local path aliases, but keep runtime
  // dependencies external. Several Express/SQLite dependencies are CommonJS
  // and break when inlined into an ESM bundle.
  noExternal: [/^@singulary\//],
  external: [
    'better-sqlite3',
    'cookie-parser',
    'cors',
    'express',
    'ws',
    'zod'
  ],
  splitting: false,
});
