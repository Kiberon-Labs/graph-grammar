import { defineConfig } from 'vitest/config'

// The node-appearance helpers (nodePaint.ts) are pure , no DOM, no canvas , so
// they run in a plain node environment with a hand-rolled mock 2D context.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
