import type { Grammar } from '../types.ts'
import { pn, pe, rn, emb, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 6. Node merge / contraction. The rule X,* deletes the wildcard neighbour and
//    X *inherits all of its other edges* via the `redirectTo` embedding. This
//    is the canonical use of edge embedding: the neighbour's connections to the
//    rest of the graph (which the fixed pattern can't enumerate) are rewired
//    onto X, preserving each edge's direction and label.
// ---------------------------------------------------------------------------
export function nodeMerge (): Grammar {
  const start = emptyGraph()
  const x = makeNode('X', {}, 400, 320)
  start.nodes.push(x)
  // a few "hub" neighbours of X, each carrying its own little cluster of leaves
  const hubs = [
    { hx: 200, hy: 180, leaves: 3 },
    { hx: 620, hy: 200, leaves: 2 },
    { hx: 400, hy: 540, leaves: 4 },
  ]
  hubs.forEach((h) => {
    const hub = makeNode('hub', {}, h.hx, h.hy)
    start.nodes.push(hub)
    start.edges.push(makeEdge(x.id, hub.id, 'link', false))
    for (let k = 0; k < h.leaves; k++) {
      const a = (k / h.leaves) * Math.PI - Math.PI / 2
      const leaf = makeNode('leaf', {}, h.hx + Math.cos(a) * 90, h.hy + Math.sin(a) * 90)
      start.nodes.push(leaf)
      start.edges.push(makeEdge(hub.id, leaf.id, 'knows', true))
    }
  })

  const merge = rule({
    name: 'Merge neighbour into X',
    description:
      "X,* : the wildcard neighbour is deleted and X inherits ALL of its other edges (direction & label preserved) via the redirectTo embedding. Step through to watch X absorb each hub's whole cluster; with a pure wildcard it eventually contracts the entire connected component into a single X.",
    color: '#f06595',
    lhs: {
      nodes: [pn('x', 'X'), pn('y', '*', { wildcard: true })],
      edges: [pe('e', 'x', 'y', { anyDirection: true, label: 'link' })],
    },
    rhs: {
      // X is preserved; y (the *) has no RHS node → it is deleted.
      nodes: [rn('x', 'X', { mapFrom: 'x' })],
      edges: [],
    },
    // y's edges to the rest of the graph are redirected onto X.
    embedding: [emb('y', 'redirectTo', { targetRhsNodeId: 'x' })],
  })

  return grammar('06 · Node Merge (contraction)', [merge], start, {
    strategy: 'random',
    maxSteps: 60,
    seed: 7,
  })
}
