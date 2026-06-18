import type { Grammar } from '../types.ts'
import { pn, pe, rn, re, rule, grammar, lit } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 4. Property + stochastic: infection spread on a network (SIR-ish).
// ---------------------------------------------------------------------------
export function infection (): Grammar {
  const start = emptyGraph()
  // a ring of people, one infected
  const N = 24
  const ids: string[] = []
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2
    const n = makeNode('person', { state: i === 0 ? 'I' : 'S', days: 0 }, 400 + Math.cos(angle) * 220, 320 + Math.sin(angle) * 220)
    start.nodes.push(n)
    ids.push(n.id)
  }
  for (let i = 0; i < N; i++) {
    start.edges.push(makeEdge(ids[i], ids[(i + 1) % N], '', false))
    start.edges.push(makeEdge(ids[i], ids[(i + 3) % N], '', false)) // some long links
  }

  const infect = rule({
    name: 'Infect neighbour',
    description: 'An infected person (state=I) infects a susceptible (state=S) neighbour with probability 0.35.',
    color: '#ff6b6b',
    probability: 0.35,
    lhs: {
      nodes: [
        pn('i', 'person', { predicates: [{ key: 'state', op: 'eq', value: 'I' }] }),
        pn('s', 'person', { predicates: [{ key: 'state', op: 'eq', value: 'S' }] }),
      ],
      edges: [pe('e', 'i', 's')],
    },
    rhs: {
      nodes: [
        rn('i', 'person', { mapFrom: 'i' }),
        rn('s', 'person', { mapFrom: 's', setProps: { state: lit('I') } }),
      ],
      edges: [re('e', 'i', 's', { mapFrom: 'e' })],
    },
  })

  const recover = rule({
    name: 'Recover',
    description: 'An infected person recovers (state=I → R) with probability 0.15.',
    color: '#51cf66',
    probability: 0.15,
    lhs: { nodes: [pn('i', 'person', { predicates: [{ key: 'state', op: 'eq', value: 'I' }] })], edges: [] },
    rhs: { nodes: [rn('i', 'person', { mapFrom: 'i', setProps: { state: lit('R') } })], edges: [] },
  })

  return grammar('04 · Infection Spread (stochastic + properties)', [infect, recover], start, {
    strategy: 'random',
    maxSteps: 400,
    seed: 42,
  })
}
