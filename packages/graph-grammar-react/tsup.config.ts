import { defineConfig } from 'tsup'

// ESM-only React component library. `react`/`react-dom` are peer deps and
// `graph-grammar`, `d3`, dagre, and elk are runtime deps , tsup externalizes all
// of them automatically (so they aren't duplicated into the bundle). The
// stylesheet ships separately as ./styles.css (imported by consumers), so it is
// not part of the JS build.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  target: 'es2022',
  clean: true,
  treeshake: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})
