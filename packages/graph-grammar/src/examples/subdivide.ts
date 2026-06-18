import type { Grammar } from '../types.ts'
import { pn, pe, rn, re, rule, grammar } from '../builders.ts'
import { gridGraph } from '../serialize.ts'

// ---------------------------------------------------------------------------
// 3. Edge subdivision , insert a node in the middle of every X–Y edge. Great
//    demo of preserving endpoints while rewiring the connecting edge.
// ---------------------------------------------------------------------------
export function subdivide (): Grammar {
  const start = gridGraph(4, 3, 'X')

  const r = rule({
    name: 'Subdivide edge',
    description:
      'Every X,X edge gains a midpoint M: X,M,X. Shows edge preservation + replacement. Matching only X–X edges (not the new X–M edges) keeps it from re-subdividing its own output.',
    color: '#ffd43b',
    lhs: {
      nodes: [pn('a', 'X'), pn('b', 'X')],
      edges: [pe('e', 'a', 'b')],
    },
    rhs: {
      nodes: [rn('a', 'X', { mapFrom: 'a' }), rn('b', 'X', { mapFrom: 'b' }), rn('m', 'M', {})],
      edges: [re('e1', 'a', 'm'), re('e2', 'm', 'b')],
    },
  })

  // The inverse operation: collapse a midpoint X,M,X back into a single X,X edge.
  // The `exactDegree: 2` condition ensures we only remove genuine midpoints (an M
  // touching exactly its two X neighbours), never an M that branches elsewhere.
  // Disabled by default so the example subdivides out of the box , enable it (and
  // disable "Subdivide edge") to run the reverse and dissolve the midpoints.
  const merge = rule({
    name: 'Merge midpoint (reverse)',
    description:
      'Collapses X,M,X into a direct X,X edge, deleting the midpoint M. The inverse of subdivision; matches only degree-2 midpoints.',
    color: '#ff922b',
    enabled: false,
    lhs: {
      nodes: [pn('a', 'X'), pn('m', 'M'), pn('b', 'X')],
      edges: [pe('e1', 'a', 'm'), pe('e2', 'm', 'b')],
    },
    rhs: {
      nodes: [rn('a', 'X', { mapFrom: 'a' }), rn('b', 'X', { mapFrom: 'b' })],
      edges: [re('e', 'a', 'b')],
    },
  })
  // only dissolve true midpoints (M connected to exactly its two X neighbours)
  merge.lhs.nodes[1].exactDegree = 2

  return grammar('03 · Edge Subdivision', [r, merge], start, { strategy: 'maximal', maxSteps: 20 })
}
