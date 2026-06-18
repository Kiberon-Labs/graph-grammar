import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { proppMorphologyV2, validateTale, narrateTale } from '../src/examples/propp-v2.ts'
import type { Graph } from '../src/types.ts'

function generate (seed: number): Graph {
  const g = proppMorphologyV2()
  g.config.seed = seed
  const eng = new Engine(g)
  eng.run(5000)
  return eng.graph
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)

describe('Propp morphology v2 (concrete tale)', () => {
  it('every generated tale is well-formed: structure + fully concretized', () => {
    for (const seed of SEEDS) {
      const graph = generate(seed)
      const { ok, violations } = validateTale(graph)
      expect(ok, `seed ${seed}: ${violations.map((v) => v.detail).join('; ')}`).toBe(true)
    }
  })

  it('the structural frontier always dissolves (pass 1 completes)', () => {
    for (const seed of SEEDS) {
      const graph = generate(seed)
      expect(graph.nodes.some((n) => n.label === 'Tale'), `seed ${seed} frontier`).toBe(false)
    }
  })

  it('narrateTale renders coherent prose with no leftover slots', () => {
    for (const seed of SEEDS) {
      const story = narrateTale(generate(seed))
      expect(story.length, `seed ${seed} empty`).toBeGreaterThan(40)
      expect(/\{[a-zA-Z]\w*\}/.test(story), `seed ${seed} unfilled slot in: ${story}`).toBe(false)
    }
  })

  it('casts a complete journey itinerary (home → gateway → wilds → lair) with a paved road', () => {
    for (const seed of SEEDS) {
      const graph = generate(seed)
      for (const role of ['home', 'gateway', 'wilds', 'lair']) {
        const stop = graph.nodes.find((n) => n.label === 'Location' && n.props.role === role)
        expect(stop?.props.cast, `seed ${seed}: ${role} not cast`).toBe(true)
      }
      const roads = graph.edges.filter((e) => e.label === 'road').length
      expect(roads, `seed ${seed}: road not fully paved`).toBe(3)
      expect(graph.edges.some((e) => e.label === 'at'), `seed ${seed}: hero not placed`).toBe(true)
    }
  })

  it('weaves a social web: across seeds, villain/rival relationship bonds are drawn and surfaced in prose', () => {
    let villainBond = false; let rivalBond = false; let kinEdges = false
    for (const seed of SEEDS) {
      const graph = generate(seed)
      if (graph.nodes.some((n) => n.label === 'Villain' && typeof n.props.bondType === 'string')) villainBond = true
      if (graph.nodes.some((n) => n.label === 'FalseHero' && typeof n.props.bondType === 'string')) rivalBond = true
      if (graph.edges.some((e) => e.label === 'kin')) kinEdges = true
    }
    expect(villainBond, 'no villain ever bonded to the taken one').toBe(true)
    expect(rivalBond, 'no rival ever bonded to the hero').toBe(true)
    expect(kinEdges, 'no kin edges ever drawn').toBe(true)
  })

  it('draws a varied cast across seeds (different heroes / villains appear)', () => {
    const heroes = new Set<unknown>()
    const villains = new Set<unknown>()
    for (const seed of SEEDS) {
      const graph = generate(seed)
      heroes.add(graph.nodes.find((n) => n.label === 'Hero')?.props.name)
      villains.add(graph.nodes.find((n) => n.label === 'Villain')?.props.name)
    }
    expect(heroes.size, 'hero never varied').toBeGreaterThan(1)
    expect(villains.size, 'villain never varied').toBeGreaterThan(1)
  })
})
