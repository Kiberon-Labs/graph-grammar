import type { Graph, Grammar } from '../types.ts'
import { pn, pe, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Chemistry II , the Diels–Alder [4+2] cycloaddition.
//
// One concerted rule, captured exactly. A conjugated *diene* (four carbons,
// C=C–C=C) and a *dienophile* (a C=C) come together and, in a single pericyclic
// step, three bonds rearrange:
//   • two NEW σ-bonds close the ring (diene termini → dienophile carbons),
//   • the diene's two C=C double bonds slide to single,
//   • a new C=C appears in the middle of the old diene,
//   • the dienophile's C=C drops to single.
// The product is a cyclohexene ring. Atoms are carbons (label "C", implicit
// hydrogens, skeletal-formula style); edge labels are bond orders ("-"/"=").
//
// This is the textbook example of why graph rewriting fits chemistry: the rule
// IS the reaction's bond-electron rearrangement, drawn once. Step through it to
// watch each diene + dienophile pair snap shut into a six-membered ring.
// ---------------------------------------------------------------------------
export function dielsAlder (): Grammar {
  const start = buildReactants()

  const cycloaddition = rule({
    name: 'Diels–Alder: diene + dienophile → cyclohexene',
    description:
      "Diene C1=C2–C3=C4 meets dienophile C5=C6. Two new σ-bonds form (C1–C6 and C4–C5) to close a ring; the diene's C1=C2 and C3=C4 relax to single bonds while C2–C3 becomes the new double bond, and the dienophile's C5=C6 drops to single. Six carbons, one cyclohexene ring.",
    color: '#9775fa',
    lhs: {
      nodes: [
        pn('c1', 'C'),
        pn('c2', 'C'),
        pn('c3', 'C'),
        pn('c4', 'C'),
        // The dienophile is an *isolated* C=C: each of its carbons has exactly one
        // bond (degree 1). This stops the pattern from cannibalising a diene's own
        // terminal double bond (whose inner carbon has degree 2) as the dienophile.
        { ...pn('c5', 'C'), exactDegree: 1 },
        { ...pn('c6', 'C'), exactDegree: 1 },
      ],
      edges: [
        pe('c12', 'c1', 'c2', { label: '=' }),
        pe('c23', 'c2', 'c3', { label: '-' }),
        pe('c34', 'c3', 'c4', { label: '=' }),
        pe('c56', 'c5', 'c6', { label: '=' }), // the dienophile (a separate molecule)
      ],
    },
    rhs: {
      nodes: [
        rn('c1', 'C', { mapFrom: 'c1' }),
        rn('c2', 'C', { mapFrom: 'c2' }),
        rn('c3', 'C', { mapFrom: 'c3' }),
        rn('c4', 'C', { mapFrom: 'c4' }),
        rn('c5', 'C', { mapFrom: 'c5' }),
        rn('c6', 'C', { mapFrom: 'c6' }),
      ],
      edges: [
        re('c12', 'c1', 'c2', { mapFrom: 'c12', label: '-' }), // was =, now single
        re('c23', 'c2', 'c3', { mapFrom: 'c23', label: '=' }), // was -, now the new double bond
        re('c34', 'c3', 'c4', { mapFrom: 'c34', label: '-' }), // was =, now single
        re('c56', 'c5', 'c6', { mapFrom: 'c56', label: '-' }), // dienophile = → single
        re('c45', 'c4', 'c5', { label: '-' }), // new σ-bond
        re('c16', 'c1', 'c6', { label: '-' }), // new σ-bond , ring closed
      ],
    },
  })

  return grammar('⬡ Chemistry: Diels–Alder Cycloaddition', [cycloaddition], start, {
    strategy: 'random',
    maxSteps: 12,
    seed: 3,
  })
}

// Three diene + dienophile pairs, each laid out so the forming ring is legible.
function buildReactants (): Graph {
  const g = emptyGraph()

  const pair = (ox: number, oy: number) => {
    // s-cis diene in a shallow U: C1=C2–C3=C4
    const c1 = makeNode('C', {}, ox, oy)
    const c2 = makeNode('C', {}, ox + 55, oy + 38)
    const c3 = makeNode('C', {}, ox + 120, oy + 38)
    const c4 = makeNode('C', {}, ox + 175, oy)
    // dienophile C5=C6 sitting below the diene's open mouth
    const c5 = makeNode('C', {}, ox + 120, oy + 120)
    const c6 = makeNode('C', {}, ox + 55, oy + 120)
    g.nodes.push(c1, c2, c3, c4, c5, c6)
    g.edges.push(
      makeEdge(c1.id, c2.id, '=', false),
      makeEdge(c2.id, c3.id, '-', false),
      makeEdge(c3.id, c4.id, '=', false),
      makeEdge(c5.id, c6.id, '=', false)
    )
  }

  pair(120, 110)
  pair(420, 110)
  pair(270, 360)

  return g
}
