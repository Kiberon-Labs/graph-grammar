import type { Grammar } from '../types.ts'
import { pn, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 8. Stress test , uncapped fractal growth. Every Leaf splits into a Node with
//    two child Leaves, so the match-set grows with the graph: the case that
//    proves the engine applies one rewrite in O(match-find), not O(matches).
//    Use the ⚡ Turbo button on this to see raw steps/sec.
// ---------------------------------------------------------------------------
export function fractalGrowth (): Grammar {
  const start = emptyGraph()
  start.nodes.push(makeNode('Leaf', {}, 400, 300))
  const split = rule({
    name: 'Leaf splits (fractal)',
    description: 'Leaf → internal Node with two child Leaves. Uncapped: the match set grows with the graph, which is the worst case for naïve engines.',
    color: '#4dabf7',
    lhs: { nodes: [pn('l', 'Leaf')], edges: [] },
    rhs: {
      nodes: [rn('n', 'Node', { mapFrom: 'l' }), rn('a', 'Leaf', {}), rn('b', 'Leaf', {})],
      edges: [re('l', 'n', 'a', { directed: true }), re('r', 'n', 'b', { directed: true })],
    },
  })
  // capped at 25k nodes so the *render* stays sane; Turbo still reports the rate.
  return grammar('⚡ Stress · Fractal Growth', [split], start, {
    strategy: 'random',
    maxSteps: 10_000_000,
    maxNodes: 25_000,
    seed: 1,
  })
}
