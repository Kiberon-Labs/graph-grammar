import { bench, describe } from 'vitest'
import { GraphIndex, makeNode, emptyGraph } from '../src/graph.ts'
import { findMatches } from '../src/match.ts'
import { Engine } from '../src/engine.ts'
import { randomGraph } from '../src/serialize.ts'
import { pn, pe, rn, re, rule, grammar } from '../src/builders.ts'
import { buildExample } from '../src/examples.ts'
import type { Grammar } from '../src/types.ts'

// ============================================================================
// Performance benchmarks (run with `npm run bench` â†’ `vitest bench`).
// Reports ops/sec for each case. Two things matter for "max iteration speed":
//   1. Raw subgraph-matching throughput on large host graphs.
//   2. Rewrite throughput for grammars whose match-set stays small (linear
//      frontier) vs. grows with the graph (parallel growth) â€” the latter is the
//      case a naÃ¯ve "enumerate all matches to apply one" engine degrades to
//      O(N^2) on.
// ============================================================================

describe('subgraph matching (find all Aâ€“B edges)', () => {
  for (const N of [1000, 5000, 20000]) {
    const g = randomGraph(N, 1.5, ['A', 'B', 'C', 'D'])
    const idx = new GraphIndex(g)
    const pat = { nodes: [pn('a', 'A'), pn('b', 'B')], edges: [pe('e', 'a', 'b', { anyDirection: true })] }
    findMatches('r', pat, idx, { limit: 1 }) // warm
    bench(`N=${N} (${g.edges.length} edges)`, () => {
      findMatches('r', pat, idx)
    })
  }
})

/** Linear frontier: exactly one "tip" exists at a time â†’ match-set size 1. */
function linearGrowth (): Grammar {
  const start = emptyGraph()
  start.nodes.push(makeNode('Tip', {}, 0, 0))
  const grow = rule({
    name: 'grow',
    lhs: { nodes: [pn('t', 'Tip')], edges: [] },
    rhs: { nodes: [rn('body', 'Body', { mapFrom: 't' }), rn('tip', 'Tip', {})], edges: [re('e', 'body', 'tip', { directed: true })] },
  })
  return grammar('linear', [grow], start, { strategy: 'random', maxSteps: 1e9, maxNodes: 0 })
}

/** Parallel growth: every Leaf can split â†’ match-set grows with the graph. */
function parallelGrowth (): Grammar {
  const start = emptyGraph()
  start.nodes.push(makeNode('Leaf', {}, 0, 0))
  const split = rule({
    name: 'split',
    lhs: { nodes: [pn('l', 'Leaf')], edges: [] },
    rhs: { nodes: [rn('n', 'Node', { mapFrom: 'l' }), rn('a', 'Leaf', {}), rn('b', 'Leaf', {})], edges: [re('l', 'n', 'a', { directed: true }), re('r', 'n', 'b', { directed: true })] },
  })
  return grammar('parallel', [split], start, { strategy: 'random', maxSteps: 1e9, maxNodes: 0 })
}

function growTo (g: Grammar, targetNodes: number) {
  const eng = new Engine(g)
  while (eng.index.nodes.size < targetNodes) {
    const r = eng.step()
    if (!r.applied && !r.ruleId) break
  }
}

describe('rewrite throughput (grow to 20k nodes)', () => {
  bench('linear frontier (constant match set)', () => growTo(linearGrowth(), 20000))
  bench('parallel growth (match set grows with graph)', () => growTo(parallelGrowth(), 20000))
})

describe('end-to-end', () => {
  bench('full dungeon generation (run to fixpoint)', () => {
    new Engine(buildExample('dungeon')).run(1000)
  })
})
