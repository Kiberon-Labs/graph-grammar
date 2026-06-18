import type { Grammar } from '../types.ts'
import { pn, rn, re, rule, grammar, incProp } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 5. Binary tree generation from a single root, with a counter property.
// ---------------------------------------------------------------------------
export function binaryTree (): Grammar {
  const start = emptyGraph()
  start.nodes.push(makeNode('leaf', { depth: 0 }, 400, 80))

  const split = rule({
    name: 'Leaf splits',
    description:
      'A leaf at depth<5 becomes an internal node with two child leaves whose depth = parent.depth + 1. The depth predicate stops growth , a clean way to bound recursion without a NAC.',
    color: '#845ef7',
    probability: 0.9,
    lhs: { nodes: [pn('l', 'leaf', { predicates: [{ key: 'depth', op: 'lt', value: 5 }] })], edges: [] },
    rhs: {
      nodes: [
        rn('n', 'node', { mapFrom: 'l' }),
        rn('a', 'leaf', { setProps: { depth: incProp('l', 'depth', 1) } }),
        rn('b', 'leaf', { setProps: { depth: incProp('l', 'depth', 1) } }),
      ],
      edges: [re('l', 'n', 'a', { label: 'L', directed: true }), re('r', 'n', 'b', { label: 'R', directed: true })],
    },
  })

  return grammar('05 · Binary Tree', [split], start, { strategy: 'random', maxSteps: 80, maxNodes: 120, seed: 3 })
}
