import type { Grammar } from '../types.ts'
import { pn, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 2. L-system style growth: a single "stem" repeatedly sprouts.
// ---------------------------------------------------------------------------
export function plantGrowth (): Grammar {
  const start = emptyGraph()
  const root = makeNode('seed', {}, 400, 500)
  start.nodes.push(root)

  const sprout = rule({
    name: 'Seed sprouts stem',
    description: 'A seed becomes a stem with a growing bud.',
    color: '#63e6be',
    lhs: { nodes: [pn('s', 'seed')], edges: [] },
    rhs: {
      nodes: [rn('stem', 'stem', { mapFrom: 's' }), rn('bud', 'bud', {})],
      edges: [re('g', 'stem', 'bud', { label: 'grows', directed: true })],
    },
  })

  const extend = rule({
    name: 'Bud extends',
    description: 'A bud pushes out another stem segment and a new bud (the main growth driver).',
    color: '#74c0fc',
    weight: 3,
    lhs: { nodes: [pn('b', 'bud')], edges: [] },
    rhs: {
      nodes: [rn('stem', 'stem', { mapFrom: 'b' }), rn('bud', 'bud', {})],
      edges: [re('g', 'stem', 'bud', { label: 'grows', directed: true })],
    },
  })

  const branch = rule({
    name: 'Bud branches',
    description: 'A bud forks into a stem with TWO new buds , this is what makes the plant bushy.',
    color: '#38d9a9',
    weight: 1.2,
    lhs: { nodes: [pn('b', 'bud')], edges: [] },
    rhs: {
      nodes: [
        rn('stem', 'stem', { mapFrom: 'b' }),
        rn('b1', 'bud', {}),
        rn('b2', 'bud', {}),
      ],
      edges: [
        re('g1', 'stem', 'b1', { label: 'grows', directed: true }),
        re('g2', 'stem', 'b2', { label: 'grows', directed: true }),
      ],
    },
  })

  const flower = rule({
    name: 'Bud flowers',
    description: 'A bud terminates into a flower (competes with extension/branching).',
    color: '#f783ac',
    probability: 0.5,
    weight: 0.8,
    lhs: { nodes: [pn('b', 'bud')], edges: [] },
    rhs: { nodes: [rn('f', 'flower', { mapFrom: 'b' })], edges: [] },
  })

  return grammar('02 · Plant Growth (L-system)', [sprout, extend, branch, flower], start, {
    strategy: 'random',
    maxSteps: 120,
    maxNodes: 80,
    seed: 7,
  })
}
