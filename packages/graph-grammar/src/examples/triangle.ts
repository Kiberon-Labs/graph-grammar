import type { Grammar, Graph } from '../types.ts'
import { pn, pe, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 1. The classic: a triangle of A's collapses into a linear B–B–B chain.
// ---------------------------------------------------------------------------
export function triangleToChain (): Grammar {
  const start: Graph = (() => {
    const g = emptyGraph()
    const a = makeNode('A', {}, 360, 200)
    const b = makeNode('A', {}, 460, 360)
    const c = makeNode('A', {}, 260, 360)
    g.nodes.push(a, b, c)
    g.edges.push(makeEdge(a.id, b.id, '', false), makeEdge(b.id, c.id, '', false), makeEdge(c.id, a.id, '', false))
    return g
  })()

  const r = rule({
    name: 'Triangle of A → chain of B',
    description:
      'Matches three mutually-connected A nodes and rewrites them into a linear B–B–B path. Dangling edges from the corners are redirected onto the new chain.',
    color: '#6ea8fe',
    lhs: {
      nodes: [pn('a', 'A', { x: 120, y: 80 }), pn('b', 'A', { x: 220, y: 200 }), pn('c', 'A', { x: 20, y: 200 })],
      edges: [pe('e1', 'a', 'b'), pe('e2', 'b', 'c'), pe('e3', 'c', 'a')],
    },
    rhs: {
      nodes: [
        rn('b1', 'B', { mapFrom: 'a', x: 60, y: 140 }),
        rn('b2', 'B', { mapFrom: 'b', x: 160, y: 140 }),
        rn('b3', 'B', { mapFrom: 'c', x: 260, y: 140 }),
      ],
      edges: [re('re1', 'b1', 'b2', { directed: true }), re('re2', 'b2', 'b3', { directed: true })],
    },
  })

  return grammar('01 · Triangle → Chain', [r], start, { strategy: 'random', maxSteps: 10 })
}
