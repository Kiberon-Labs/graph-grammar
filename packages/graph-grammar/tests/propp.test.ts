import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { makeNode } from '../src/graph.ts'
import { proppMorphology, validateTale } from '../src/examples/propp.ts'
import type { Graph } from '../src/types.ts'

// Run the grammar to a halt under a given seed and return the final graph.
function generate (seed: number): Graph {
  const g = proppMorphology()
  g.config.seed = seed
  const eng = new Engine(g)
  eng.run(500)
  return eng.graph
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)

describe('Propp morphology grammar', () => {
  it('every generated tale is well-formed (no unfired guns, no loose threads)', () => {
    for (const seed of SEEDS) {
      const graph = generate(seed)
      const { ok, violations } = validateTale(graph)
      expect(ok, `seed ${seed}: ${violations.map((v) => v.detail).join('; ')}`).toBe(true)
    }
  })

  it('always halts cleanly: no frontier and no leftover obligations remain', () => {
    for (const seed of SEEDS) {
      const graph = generate(seed)
      expect(graph.nodes.some((n) => n.label === 'Tale'), `seed ${seed} frontier`).toBe(false)
      expect(graph.nodes.some((n) => n.label === 'Villain'), `seed ${seed} villain`).toBe(false)
      expect(graph.nodes.some((n) => n.label === 'Lack'), `seed ${seed} lack`).toBe(false)
      expect(graph.nodes.some((n) => n.label === 'FalseHero'), `seed ${seed} false hero`).toBe(false)
    }
  })

  it('preserves the obligatory spine in canonical order (α … A … K … W)', () => {
    const graph = generate(7)
    const order = graph.nodes
      .filter((n) => typeof n.props?.sym === 'string')
      .sort((a, b) => (a.props.n as number) - (b.props.n as number))
      .map((n) => n.props.sym as string)
    for (const s of ['α', 'A', 'K', 'W']) expect(order).toContain(s)
    const idx = (s: string) => order.indexOf(s)
    expect(idx('α')).toBeLessThan(idx('A'))
    expect(idx('A')).toBeLessThan(idx('K'))
    expect(idx('K')).toBeLessThan(idx('W'))
  })

  it('realises genuine variety across seeds (agent path, task path, false-hero exposure all occur)', () => {
    let agentUsed = false; let taskPath = false; let exposed = false
    for (const seed of SEEDS) {
      const graph = generate(seed)
      const syms = new Set(graph.nodes.map((n) => n.props?.sym))
      if (graph.edges.some((e) => e.label === 'uses')) agentUsed = true // agent climax (gun fired)
      if (syms.has('M')) taskPath = true // difficult-task climax
      if (syms.has('Ex')) exposed = true // false hero exposed
    }
    expect(agentUsed, 'no run used the agent').toBe(true)
    expect(taskPath, 'no run took the difficult-task climax').toBe(true)
    expect(exposed, 'no run exposed a false hero').toBe(true)
  })

  it('the Chekhov constraint holds: a received agent is never left unused', () => {
    for (const seed of SEEDS) {
      const graph = generate(seed)
      const used = new Set<string>()
      for (const e of graph.edges) if (e.label === 'uses') { used.add(e.source); used.add(e.target) }
      for (const a of graph.nodes.filter((n) => n.label === 'Agent')) {
        expect(used.has(a.id), `seed ${seed}: agent received but unused`).toBe(true)
      }
    }
  })

  it('the validator actually catches a broken tale (negative control)', () => {
    // Take a clean tale and re-introduce an un-liquidated Lack , the validator
    // must flag it. Proves the check has teeth, not just that tales pass.
    const graph = generate(7)
    expect(validateTale(graph).ok).toBe(true)
    graph.nodes.push(makeNode('Lack', { of: 'the firebird' }))
    const res = validateTale(graph)
    expect(res.ok).toBe(false)
    expect(res.violations.some((v) => v.kind === 'unliquidated-lack')).toBe(true)
  })
})
