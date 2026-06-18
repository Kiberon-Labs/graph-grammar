import type { Grammar } from '../types.ts'
import { grammar } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 13. Empty starter grammar for authoring from scratch.
// ---------------------------------------------------------------------------
export function blank (): Grammar {
  const start = emptyGraph()
  start.nodes.push(makeNode('A', {}, 380, 300))
  return grammar('Blank canvas', [], start, { strategy: 'random', maxSteps: 100 })
}
