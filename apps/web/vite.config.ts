import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The demo app consumes the workspace packages directly from source during
// dev/build via these aliases , no pre-build of the library or editor is
// required. (The published artifacts are validated separately by each package's
// own `build` + `typecheck`.) Order matters: more specific ids first.
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const pkg = (p: string) => at(`../../packages/${p}`)

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'graph-grammar-react/styles.css', replacement: pkg('graph-grammar-react/styles.css') },
      { find: 'graph-grammar-react', replacement: pkg('graph-grammar-react/src/index.ts') },
      { find: 'graph-grammar/examples', replacement: pkg('graph-grammar/src/examples.ts') },
      { find: 'graph-grammar', replacement: pkg('graph-grammar/src/index.ts') },
    ],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    // Honour the PORT env var so external preview/launchers can pin the port.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
})
