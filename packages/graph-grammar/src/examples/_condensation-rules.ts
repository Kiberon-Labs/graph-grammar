import type { Rule } from '../types.ts'
import { pn, pe, rn, emb, rule } from '../builders.ts'

// Shared by the network examples (small + large): the two cycle-condensation
// rules. Each contracts a directed cycle into a single node that INHERITS the
// cycle's outside edges (via redirectTo embedding); the acyclic backbone never
// matches, so it is left untouched. `priority` makes triangles contract before
// mutual pairs under the `priority` strategy.
export function condensationRules (): { contractLoop: Rule; collapseMutual: Rule } {
  const collapseMutual = rule({
    name: 'Collapse mutual route (2-cycle)',
    description:
      "Two nodes that route to each other (A→B and B→A) form a redundant loop. Merge B into A: A is kept and inherits all of B's outside edges via the redirectTo embedding, so the mutual pair becomes a single node with the loop gone.",
    color: '#ffa94d',
    priority: 1,
    lhs: {
      nodes: [pn('a', '*', { wildcard: true }), pn('b', '*', { wildcard: true })],
      edges: [pe('ab', 'a', 'b', { directed: true }), pe('ba', 'b', 'a', { directed: true })],
    },
    rhs: {
      nodes: [rn('a', 'R', { mapFrom: 'a' })], // b has no RHS node → deleted
      edges: [],
    },
    embedding: [emb('b', 'redirectTo', { targetRhsNodeId: 'a' })],
  })

  const contractLoop = rule({
    name: 'Contract routing loop (3-cycle)',
    description:
      'A directed 3-cycle A→B→C→A is a routing loop. Contract it into a single node A, which inherits every outside edge of B and C (redirectTo embedding). The three internal loop edges are dropped. Larger loops collapse once they contain a triangle.',
    color: '#ff6b6b',
    priority: 2,
    lhs: {
      nodes: [
        pn('a', '*', { wildcard: true }),
        pn('b', '*', { wildcard: true }),
        pn('c', '*', { wildcard: true }),
      ],
      edges: [
        pe('ab', 'a', 'b', { directed: true }),
        pe('bc', 'b', 'c', { directed: true }),
        pe('ca', 'c', 'a', { directed: true }),
      ],
    },
    rhs: {
      nodes: [rn('a', 'R', { mapFrom: 'a' })], // b, c deleted
      edges: [],
    },
    embedding: [
      emb('b', 'redirectTo', { targetRhsNodeId: 'a' }),
      emb('c', 'redirectTo', { targetRhsNodeId: 'a' }),
    ],
  })

  return { contractLoop, collapseMutual }
}
