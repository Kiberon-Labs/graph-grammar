import type { Graph, Grammar } from '../types.ts'
import { pn, pe, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Chemistry III , radical addition polymerisation (chain growth).
//
// The same atoms-as-nodes / bonds-as-edges model, now showing *growth*: a
// living chain end (a carbon radical "C·") repeatedly adds vinyl monomers
// (ethylene, C=C) and the radical hops to the new free end. Each addition
// lengthens the backbone by two carbons and relocates the reactive site, so a
// polymer chain snakes outward monomer by monomer , an L-system, but a real
// one. "R" marks each initiator head so you can see where a chain began.
//
//   R–C·  +  C=C   →   R–C–C–C·        (propagation)
//
// Chains keep growing until two radical ends meet and couple (termination),
// capping both. Run it and watch the monomer pool convert into a few long
// backbones; tracking which chain a carbon belongs to is just following the
// edges back to its "R".
// ---------------------------------------------------------------------------
export function polymerization (): Grammar {
  const start = buildMonomerBath()

  // Propagation: the radical chain end adds a monomer; the radical moves to the
  // monomer's far carbon. Backbone grows by two carbons.
  const propagate = rule({
    name: 'Propagate: ⋯C· + CH₂=CH₂ → ⋯C–CH₂–CH₂·',
    description:
      "The active chain end (C·) attacks a vinyl monomer's double bond: a new C–C σ-bond ties the monomer onto the backbone, the monomer's C=C relaxes to single, and the unpaired electron relocates to the monomer's other carbon , ready to add the next one. This single rule, applied over and over, is the whole chain reaction.",
    color: '#20c997',
    group: 'Growth',
    weight: 5,
    probability: 1,
    lhs: {
      nodes: [pn('end', 'C·'), pn('ma', 'C'), pn('mb', 'C')],
      edges: [pe('m', 'ma', 'mb', { label: '=' })],
    },
    rhs: {
      nodes: [
        rn('end', 'C', { mapFrom: 'end' }), // former end is now interior backbone
        rn('ma', 'C', { mapFrom: 'ma' }),
        rn('mb', 'C·', { mapFrom: 'mb' }), // radical hops to the new terminus
      ],
      edges: [
        re('link', 'end', 'ma', { label: '-' }), // new backbone bond
        re('m', 'ma', 'mb', { mapFrom: 'm', label: '-' }), // monomer C=C → single
      ],
    },
  })

  // Termination (combination): two living ends couple into one dead chain.
  const terminate = rule({
    name: 'Terminate: ⋯C· + ·C⋯ → ⋯C–C⋯',
    description:
      'Two radical chain ends collide and pair their unpaired electrons into a single C–C bond, joining the two chains and ending growth for both. Rarer than propagation (lower weight), so chains get long before they cap.',
    color: '#adb5bd',
    group: 'Termination',
    weight: 1,
    probability: 0.5,
    lhs: { nodes: [pn('a', 'C·'), pn('b', 'C·')], edges: [] },
    rhs: {
      nodes: [rn('a', 'C', { mapFrom: 'a' }), rn('b', 'C', { mapFrom: 'b' })],
      edges: [re('e', 'a', 'b', { label: '-' })],
    },
  })

  return grammar('🧬 Chemistry: Addition Polymerisation (chain growth)', [propagate, terminate], start, {
    strategy: 'random',
    maxSteps: 250,
    seed: 11,
  })
}

// A few initiator radicals (R–C·) afloat in a bath of ethylene monomers (C=C).
function buildMonomerBath (): Graph {
  const g = emptyGraph()

  // initiators: an "R" head bonded to a carbon radical, spaced out
  const initiators: Array<[number, number]> = [
    [150, 150],
    [620, 200],
    [330, 470],
  ]
  initiators.forEach(([x, y]) => {
    const r = makeNode('R', {}, x, y)
    const c = makeNode('C·', {}, x + 34, y)
    g.nodes.push(r, c)
    g.edges.push(makeEdge(r.id, c.id, '-', false))
  })

  // monomer bath: ethylene molecules on a jittered grid
  const cols = 7
  const ox = 120
  const oy = 250
  const sx = 90
  const sy = 78
  let placed = 0
  for (let i = 0; placed < 27; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    const cx = ox + c * sx + (r % 2 ? 34 : 0)
    const cy = oy + r * sy
    // skip slots that sit on top of an initiator
    if (initiators.some(([ix, iy]) => Math.abs(ix - cx) < 70 && Math.abs(iy - cy) < 55)) continue
    const a = makeNode('C', {}, cx - 11, cy)
    const b = makeNode('C', {}, cx + 11, cy)
    g.nodes.push(a, b)
    g.edges.push(makeEdge(a.id, b.id, '=', false))
    placed++
  }

  return g
}
