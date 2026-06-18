import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { buildExample } from '../src/examples.ts'
import type { Graph } from '../src/types.ts'

// The chemistry examples model atoms as nodes and bonds as edges. Their
// defining invariant is *conservation of mass*: rules only break/form bonds and
// flip radical labels, so the multiset of elements (ignoring the radical "·"
// suffix) must be identical before and after any run.

const element = (label: string) => label.replace('·', '')

function atomCounts (g: Graph): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of g.nodes) {
    const el = element(n.label)
    out[el] = (out[el] ?? 0) + 1
  }
  return out
}

/** degree of every node, by id */
function degrees (g: Graph): Map<string, number> {
  const d = new Map<string, number>()
  for (const n of g.nodes) d.set(n.id, 0)
  for (const e of g.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1)
    d.set(e.target, (d.get(e.target) ?? 0) + 1)
  }
  return d
}

describe('chemistry: hydrogen combustion', () => {
  it('conserves atoms and forms water (an O bonded to two H)', () => {
    const g = buildExample('combustion')
    const before = atomCounts(g.start)
    // 12 H₂ + 6 O₂ → 24 H, 12 O
    expect(before).toEqual({ H: 24, O: 12 })

    const eng = new Engine(g)
    eng.run()
    const after = atomCounts(eng.graph)

    // mass conservation: same atoms, only bonds/radicals changed
    expect(after).toEqual(before)

    // at least one water molecule formed: a non-radical O bonded to two H atoms
    const deg = degrees(eng.graph)
    const byId = new Map(eng.graph.nodes.map((n) => [n.id, n]))
    const adj = new Map<string, string[]>()
    for (const e of eng.graph.edges) {
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
      adj.set(e.target, [...(adj.get(e.target) ?? []), e.source])
    }
    const waters = eng.graph.nodes.filter((n) => {
      if (n.label !== 'O') return false
      if (deg.get(n.id) !== 2) return false
      return (adj.get(n.id) ?? []).every((id) => byId.get(id)?.label === 'H')
    })
    expect(waters.length).toBeGreaterThan(0)
  })
})

describe('chemistry: Diels–Alder cycloaddition', () => {
  it('conserves carbons and closes every reactant pair into a 6-membered ring', () => {
    const g = buildExample('diels-alder')
    // 3 pairs × 6 carbons
    expect(atomCounts(g.start)).toEqual({ C: 18 })
    // 3 pairs × 4 bonds, none in a ring yet (edges = nodes − components)
    expect(g.start.edges.length).toBe(12)

    const eng = new Engine(g)
    eng.run()

    expect(atomCounts(eng.graph)).toEqual({ C: 18 })
    // each cycloaddition adds two σ-bonds → 12 + 3×2 = 18 bonds total
    expect(eng.graph.edges.length).toBe(18)
    // every carbon ends up in a ring → degree 2 (skeletal, implicit H's)
    const deg = degrees(eng.graph)
    expect([...deg.values()].every((d) => d === 2)).toBe(true)
    // exactly one C=C double bond survives per ring (the new cyclohexene alkene)
    const doubles = eng.graph.edges.filter((e) => e.label === '=').length
    expect(doubles).toBe(3)
  })
})

describe('chemistry: addition polymerisation', () => {
  it('conserves atoms and grows the backbone by consuming monomer double bonds', () => {
    const g = buildExample('polymerization')
    const before = atomCounts(g.start)
    const startDoubles = g.start.edges.filter((e) => e.label === '=').length
    expect(startDoubles).toBeGreaterThan(0)

    const eng = new Engine(g)
    eng.run()

    // atoms conserved (R initiators + all carbons)
    expect(atomCounts(eng.graph)).toEqual(before)
    // monomers got consumed: far fewer C=C double bonds remain than at the start
    const endDoubles = eng.graph.edges.filter((e) => e.label === '=').length
    expect(endDoubles).toBeLessThan(startDoubles)
    // growth happened: the largest connected component is bigger than a lone
    // initiator (R + C·) or a single monomer.
    const adj = new Map<string, string[]>()
    for (const n of eng.graph.nodes) adj.set(n.id, [])
    for (const e of eng.graph.edges) {
      adj.get(e.source)!.push(e.target)
      adj.get(e.target)!.push(e.source)
    }
    const seen = new Set<string>()
    let largest = 0
    for (const n of eng.graph.nodes) {
      if (seen.has(n.id)) continue
      let size = 0
      const stack = [n.id]
      while (stack.length) {
        const id = stack.pop()!
        if (seen.has(id)) continue
        seen.add(id)
        size++
        for (const m of adj.get(id) ?? []) if (!seen.has(m)) stack.push(m)
      }
      largest = Math.max(largest, size)
    }
    expect(largest).toBeGreaterThan(4)
  })
})
