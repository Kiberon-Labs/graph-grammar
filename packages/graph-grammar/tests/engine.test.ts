import { describe, it, expect } from 'vitest'
import { GraphIndex, makeNode, makeEdge, emptyGraph } from '../src/graph.ts'
import { findMatches, findOneMatch } from '../src/match.ts'
import { Engine } from '../src/engine.ts'
import { RNG } from '../src/util.ts'
import { pn, pe, rn, re, rule, grammar } from '../src/builders.ts'
import { buildExample } from '../src/examples.ts'
import { histogram, fingerprint } from './helpers.ts'

describe('application strategies', () => {
  it('maximal subdivision inserts exactly one midpoint per edge and terminates', () => {
    const g = emptyGraph()
    const xs = [makeNode('X'), makeNode('X'), makeNode('X'), makeNode('X')]
    g.nodes.push(...xs)
    for (let i = 0; i < 3; i++) g.edges.push(makeEdge(xs[i].id, xs[i + 1].id, '', false))
    const sub = rule({
      name: 'sub',
      lhs: { nodes: [pn('a', 'X'), pn('b', 'X')], edges: [pe('e', 'a', 'b')] },
      rhs: { nodes: [rn('a', 'X', { mapFrom: 'a' }), rn('b', 'X', { mapFrom: 'b' }), rn('m', 'M', {})], edges: [re('e1', 'a', 'm'), re('e2', 'm', 'b')] },
    })
    const eng = new Engine(grammar('sub', [sub], g, { strategy: 'maximal', maxSteps: 50 }))
    eng.run()
    expect(histogram(eng.graph).M).toBe(3)
  })

  it('caps a rule at maxApplications', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('S'))
    const grow = rule({ name: 'g', maxApplications: 5, lhs: { nodes: [pn('s', 'S')], edges: [] }, rhs: { nodes: [rn('s', 'S', { mapFrom: 's' }), rn('n', 'N', {})], edges: [re('e', 's', 'n', {})] } })
    const eng = new Engine(grammar('cap', [grow], g, { strategy: 'random', maxSteps: 1000 }))
    eng.run()
    expect(histogram(eng.graph).N).toBe(5)
  })

  it('never fires a probability-0 rule', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('S'))
    const never = rule({ name: 'p0', probability: 0, lhs: { nodes: [pn('s', 'S')], edges: [] }, rhs: { nodes: [rn('s', 'S', { mapFrom: 's' }), rn('n', 'N', {})], edges: [] } })
    const eng = new Engine(grammar('p0', [never], g, { strategy: 'random', maxSteps: 100 }))
    eng.run()
    expect(histogram(eng.graph).N).toBeFalsy()
  })

  it('applies the highest-priority applicable rule first', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('S'))
    const lo = rule({ name: 'lo', priority: 1, lhs: { nodes: [pn('s', 'S')], edges: [] }, rhs: { nodes: [rn('s', 'Lo', { mapFrom: 's' })], edges: [] } })
    const hi = rule({ name: 'hi', priority: 10, lhs: { nodes: [pn('s', 'S')], edges: [] }, rhs: { nodes: [rn('s', 'Hi', { mapFrom: 's' })], edges: [] } })
    const eng = new Engine(grammar('pri', [lo, hi], g, { strategy: 'priority', maxSteps: 5 }))
    eng.step()
    expect(histogram(eng.graph)).toEqual({ Hi: 1 })
  })

  it('blocks a rule whose NAC is present', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('S'), makeNode('Flag'))
    const blocked = rule({ name: 'nac', lhs: { nodes: [pn('s', 'S')], edges: [] }, rhs: { nodes: [rn('s', 'S', { mapFrom: 's' }), rn('n', 'N', {})], edges: [] }, nac: [{ nodes: [pn('f', 'Flag')], edges: [] }] })
    const eng = new Engine(grammar('nac', [blocked], g, { strategy: 'random', maxSteps: 10 }))
    eng.run()
    expect(histogram(eng.graph).N).toBeFalsy()
  })

  it('respects the maxNodes bound', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('S'))
    const grow = rule({ name: 'g2', lhs: { nodes: [pn('s', 'S')], edges: [] }, rhs: { nodes: [rn('s', 'S', { mapFrom: 's' }), rn('n', 'N', {})], edges: [] } })
    const eng = new Engine(grammar('mn', [grow], g, { strategy: 'random', maxSteps: 100000, maxNodes: 20 }))
    eng.run()
    expect(eng.graph.nodes.length).toBeGreaterThanOrEqual(19)
    expect(eng.graph.nodes.length).toBeLessThanOrEqual(20)
  })
})

describe('maxNodes is a precise node budget', () => {
  const budgetGrammar = (maxNodes: number) => {
    const start = emptyGraph()
    start.nodes.push(makeNode('Bud'))
    const grow = rule({ name: 'grow', lhs: { nodes: [pn('b', 'Bud')], edges: [] }, rhs: { nodes: [rn('s', 'Stem', { mapFrom: 'b' }), rn('n', 'Bud', {})], edges: [re('e', 's', 'n', {})] } })
    const flower = rule({ name: 'flower', lhs: { nodes: [pn('b', 'Bud')], edges: [] }, rhs: { nodes: [rn('f', 'Flower', { mapFrom: 'b' })], edges: [] } })
    return new Engine(grammar('budget', [grow, flower], start, { strategy: 'random', maxSteps: -1, maxNodes, seed: 3 }))
  }

  it('computes the per-rule node delta', () => {
    const eng = budgetGrammar(10)
    const [grow, flower] = eng.grammar.rules
    expect(eng.nodeDelta(grow)).toBe(1)
    expect(eng.nodeDelta(flower)).toBe(0)
  })

  it('never overshoots and lets net-zero rules resolve at the cap', () => {
    const eng = budgetGrammar(10)
    eng.run()
    const g = eng.graph
    expect(g.nodes.length).toBeLessThanOrEqual(10) // hard cap, never exceeded
    expect(histogram(g).Bud).toBeFalsy() // the trapped bud flowered out at the cap
    expect(histogram(g).Flower).toBe(1)
  })

  it('reports a matching-but-blocked growth rule at the cap', () => {
    const start = emptyGraph()
    start.nodes.push(makeNode('Bud'))
    const grow = rule({ name: 'grow', lhs: { nodes: [pn('b', 'Bud')], edges: [] }, rhs: { nodes: [rn('s', 'Stem', { mapFrom: 'b' }), rn('n', 'Bud', {})], edges: [re('e', 's', 'n', {})] } })
    const eng = new Engine(grammar('growOnly', [grow], start, { strategy: 'random', maxSteps: -1, maxNodes: 4, seed: 1 }))
    eng.run() // grows to 4 nodes (3 Stem + 1 Bud) then can't grow further
    expect(eng.index.nodes.size).toBe(4)
    expect(histogram(eng.graph).Bud).toBe(1) // a bud still matches growâ€¦
    expect(eng.isBlockedByNodeCap(grow)).toBe(true) // â€¦but it's blocked by the cap
  })
})

describe('determinism', () => {
  const run = (seed: number) => {
    const g = buildExample('dungeon')
    g.config.seed = seed
    const e = new Engine(g)
    e.run(1000)
    return fingerprint(e.graph)
  }

  it('is byte-identical for the same seed', () => {
    expect(run(1337)).toBe(run(1337))
  })

  it('differs across seeds', () => {
    const fps = [1, 2, 3, 4, 5].map(run)
    expect(new Set(fps).size).toBeGreaterThan(1)
  })
})

describe('reset integrity', () => {
  it("does not mutate the grammar's start graph, so re-runs reproduce", () => {
    const start = emptyGraph()
    start.nodes.push(makeNode('A'))
    const r = rule({
      name: 'relabelRoot',
      maxApplications: 3,
      lhs: { nodes: [pn('a', 'A')], edges: [] },
      rhs: { nodes: [rn('a', 'B', { mapFrom: 'a' }), rn('c', 'A', {})], edges: [re('e', 'a', 'c', {})] },
    })
    const eng = new Engine(grammar('relabel', [r], start, { strategy: 'random', maxSteps: 100 }))
    eng.run()
    const first = histogram(eng.graph)
    eng.reset()
    eng.run()
    expect(histogram(eng.graph)).toEqual(first)
    expect(start.nodes[0].label).toBe('A')
  })
})

describe('index integrity after heavy rewriting', () => {
  it('keeps label buckets and incident sets consistent', () => {
    const eng = new Engine(buildExample('plant'))
    eng.run(2000)
    const idx = eng.index

    let bucketTotal = 0
    let mismatches = 0
    for (const [label, bucket] of idx.byLabel) {
      bucketTotal += bucket.size
      for (const id of bucket) {
        const n = idx.nodes.get(id)
        if (!n || n.label !== label) mismatches++
      }
    }
    expect(mismatches).toBe(0)
    expect(bucketTotal).toBe(idx.nodes.size)

    let edgeIntegrity = 0
    for (const e of idx.edges.values()) {
      if (!idx.incident.get(e.source)?.has(e.id)) edgeIntegrity++
      if (!idx.incident.get(e.target)?.has(e.id)) edgeIntegrity++
    }
    expect(edgeIntegrity).toBe(0)
  })
})

describe('degenerate inputs', () => {
  it('handles empty graphs, empty patterns, and empty-LHS rules', () => {
    const idx = new GraphIndex(emptyGraph())
    expect(findMatches('r', { nodes: [pn('a', 'A')], edges: [] }, idx)).toHaveLength(0)
    expect(findMatches('r', { nodes: [], edges: [] }, idx)).toHaveLength(0)
    expect(findOneMatch('r', { nodes: [pn('a', 'A')], edges: [] }, idx, new RNG(1))).toBeNull()

    const g = emptyGraph()
    g.nodes.push(makeNode('A'))
    const noop = rule({ name: 'noop', lhs: { nodes: [], edges: [] }, rhs: { nodes: [], edges: [] } })
    expect(new Engine(grammar('x', [noop], g, { strategy: 'random', maxSteps: 10 })).run()).toBe(0)
  })
})
