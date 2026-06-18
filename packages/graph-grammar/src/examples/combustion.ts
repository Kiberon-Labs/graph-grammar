import type { Graph, Grammar } from '../types.ts'
import { pn, pe, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Chemistry I , Hydrogen combustion as a free-radical chain.
//
// Atoms are nodes, bonds are edges. A node's label is its element symbol; a
// trailing "·" marks an unpaired electron (a radical), so radicals are both a
// distinct colour on the canvas and a distinct thing to match. Edge labels
// encode bond order: "-" single, "=" double. (NB: an *empty* edge label is the
// matcher's wildcard, so every real bond is labelled.)
//
// The overall reaction 2 H2 + O2 → 2 H2O never happens in a single elementary
// step , it runs as a chain: a rare *initiation* event makes the first
// radicals, fast *branching* and *propagation* steps carry (and multiply) the
// radicals through the H2/O2 gas, and *termination* steps recombine radicals
// back into stable molecules. Running the grammar stochastically *tracks* that
// mechanism: watch H· and O· radicals ignite, spread, and leave H2O behind (an
// O bonded to two H's).
//
// Oxygen carries three labels so the rules can tell its states apart:
//   "O"   , oxygen bound in a stable molecule (O=O, or the O of water)
//   "O·"  , a free oxygen-atom radical
//   "OH·" , the oxygen of a hydroxyl radical (bonded to exactly one H)
// ---------------------------------------------------------------------------
export function combustion (): Grammar {
  const start = buildGas()

  // 1. Initiation (rare): a H–H bond breaks homolytically into two H radicals.
  const initiation = rule({
    name: 'Initiation: H₂ → H· + H·',
    description:
      'A hydrogen molecule splits homolytically into two H radicals. This is the slow, rate-limiting spark that seeds the whole chain , hence its low probability.',
    color: '#e8590c',
    group: 'Initiation',
    weight: 1,
    probability: 0.12,
    lhs: { nodes: [pn('a', 'H'), pn('b', 'H')], edges: [pe('e', 'a', 'b', { label: '-' })] },
    rhs: { nodes: [rn('a', 'H·', { mapFrom: 'a' }), rn('b', 'H·', { mapFrom: 'b' })], edges: [] },
  })

  // 2. Chain branching: H· + O=O → HO· + O·  (one radical becomes two).
  const branching = rule({
    name: 'Branching: H· + O₂ → ·OH + O·',
    description:
      'A H radical attacks O₂: it bonds to one oxygen (forming a hydroxyl radical ·OH) and frees the other as an oxygen-atom radical O·. One radical in, two radicals out , this branching is what makes the flame accelerate.',
    color: '#f03e3e',
    group: 'Propagation',
    weight: 3,
    probability: 0.9,
    lhs: {
      nodes: [pn('h', 'H·'), pn('oa', 'O'), pn('ob', 'O')],
      edges: [pe('oo', 'oa', 'ob', { label: '=' })],
    },
    rhs: {
      nodes: [rn('h', 'H', { mapFrom: 'h' }), rn('oa', 'OH·', { mapFrom: 'oa' }), rn('ob', 'O·', { mapFrom: 'ob' })],
      edges: [re('hoa', 'h', 'oa', { label: '-' })], // new O–H bond; the old O=O is dropped
    },
  })

  // 3. Propagation: O· + H–H → ·OH + H·
  const propagateO = rule({
    name: 'Propagation: O· + H₂ → ·OH + H·',
    description:
      'An oxygen-atom radical abstracts one H from H₂, becoming a hydroxyl radical ·OH and kicking out a fresh H radical to carry the chain onward.',
    color: '#ff6b6b',
    group: 'Propagation',
    weight: 3,
    probability: 0.9,
    lhs: {
      nodes: [pn('o', 'O·'), pn('ha', 'H'), pn('hb', 'H')],
      edges: [pe('hh', 'ha', 'hb', { label: '-' })],
    },
    rhs: {
      nodes: [rn('o', 'OH·', { mapFrom: 'o' }), rn('ha', 'H', { mapFrom: 'ha' }), rn('hb', 'H·', { mapFrom: 'hb' })],
      edges: [re('oha', 'o', 'ha', { label: '-' })], // O grabs one H; H–H bond is dropped
    },
  })

  // 4. Propagation to product: ·OH + H–H → H₂O + H·
  const makeWater = rule({
    name: 'Propagation: ·OH + H₂ → H₂O + H·',
    description:
      "A hydroxyl radical pulls a second H out of H₂ to complete a water molecule (its oxygen relabels O· → O, now bonded to two H's), releasing another H radical. This is the step that lays down the product.",
    color: '#4dabf7',
    group: 'Propagation',
    weight: 3,
    probability: 0.9,
    lhs: {
      nodes: [pn('o', 'OH·'), pn('hx', 'H'), pn('ha', 'H'), pn('hb', 'H')],
      edges: [pe('ox', 'o', 'hx', { label: '-' }), pe('hh', 'ha', 'hb', { label: '-' })],
    },
    rhs: {
      nodes: [
        rn('o', 'O', { mapFrom: 'o' }), // hydroxyl O completes into water O
        rn('hx', 'H', { mapFrom: 'hx' }),
        rn('ha', 'H', { mapFrom: 'ha' }),
        rn('hb', 'H·', { mapFrom: 'hb' }),
      ],
      edges: [
        re('ox', 'o', 'hx', { mapFrom: 'ox', label: '-' }), // keep the existing O–H
        re('oha', 'o', 'ha', { label: '-' }), // new O–H → H₂O; the H–H bond is dropped
      ],
    },
  })

  // 5. Termination: H· + H· → H₂  (two radicals recombine, ending two chains).
  const terminateHH = rule({
    name: 'Termination: H· + H· → H₂',
    description:
      'Two H radicals collide and pair up into a stable H₂ molecule. A radical sink: it removes two chain carriers at once. (The LHS has no edge, so any two H radicals anywhere can recombine.)',
    color: '#868e96',
    group: 'Termination',
    weight: 1,
    probability: 0.5,
    lhs: { nodes: [pn('a', 'H·'), pn('b', 'H·')], edges: [] },
    rhs: { nodes: [rn('a', 'H', { mapFrom: 'a' }), rn('b', 'H', { mapFrom: 'b' })], edges: [re('e', 'a', 'b', { label: '-' })] },
  })

  // 6. Termination to product: H· + ·OH → H₂O
  const terminateOH = rule({
    name: 'Termination: H· + ·OH → H₂O',
    description:
      'A H radical caps a hydroxyl radical, forming water and quenching both carriers. The other route to the product , and another way the chain dies out.',
    color: '#3bc9db',
    group: 'Termination',
    weight: 2,
    probability: 0.8,
    lhs: { nodes: [pn('h', 'H·'), pn('o', 'OH·'), pn('hx', 'H')], edges: [pe('ox', 'o', 'hx', { label: '-' })] },
    rhs: {
      nodes: [rn('h', 'H', { mapFrom: 'h' }), rn('o', 'O', { mapFrom: 'o' }), rn('hx', 'H', { mapFrom: 'hx' })],
      edges: [re('ox', 'o', 'hx', { mapFrom: 'ox', label: '-' }), re('oh', 'o', 'h', { label: '-' })],
    },
  })

  return grammar(
    '🔥 Chemistry: Hydrogen Combustion (radical chain)',
    [initiation, branching, propagateO, makeWater, terminateHH, terminateOH],
    start,
    { strategy: 'random', maxSteps: 600, seed: 7 }
  )
}

// A 2:1 H₂ : O₂ gas, scattered on a grid so molecules have room to react.
function buildGas (): Graph {
  const g = emptyGraph()
  const cols = 6
  const ox = 150
  const oy = 150
  const sx = 115
  const sy = 105

  // diatomic placement helpers
  const h2 = (x: number, y: number) => {
    const a = makeNode('H', {}, x - 13, y)
    const b = makeNode('H', {}, x + 13, y)
    g.nodes.push(a, b)
    g.edges.push(makeEdge(a.id, b.id, '-', false))
  }
  const o2 = (x: number, y: number) => {
    const a = makeNode('O', {}, x - 16, y)
    const b = makeNode('O', {}, x + 16, y)
    g.nodes.push(a, b)
    g.edges.push(makeEdge(a.id, b.id, '=', false))
  }

  // pattern of 12 H₂ + 6 O₂ (every third slot is O₂) over three rows
  const kinds: Array<(x: number, y: number) => void> = []
  for (let k = 0; k < 18; k++) kinds.push(k % 3 === 2 ? o2 : h2)

  kinds.forEach((place, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const x = ox + c * sx + (r % 2 ? 40 : 0)
    const y = oy + r * sy
    place(x, y)
  })

  return g
}
