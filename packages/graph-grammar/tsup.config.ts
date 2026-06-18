import { defineConfig } from 'tsup'

// ESM-only library build. esbuild bundles the internal `.ts`-extension imports
// away, so the published artifact contains no `.ts` specifiers; `zod` is kept
// external (it's a runtime dependency, declared in package.json).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    examples: 'src/examples.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  target: 'es2022',
  clean: true,
  treeshake: true,
  external: ['zod'],
})
