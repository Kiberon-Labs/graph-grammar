import type { Graph, Grammar } from '../types.ts'
import { pn, rn, re, emb, rule, grammar, lit } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Planner II , inventory as NODES, with competing recipes (cake vs bread).
//
// Two ideas this example makes concrete:
//
// 1. INVENTORY AS NODES. Each ingredient is its own node hung off the Kitchen
//    ("has" edges) instead of a count on a Pantry prop. "Do I have 2 eggs?"
//    becomes a *subgraph match* on two `Egg` nodes, and "use them" becomes node
//    *deletion* , the engine's native operations. You can watch the larder
//    physically empty as the plan runs, no arithmetic required.
//
// 2. COMPETING PATHS. There are two recipes that share the single `Flour`:
//      bread:  Flour + Yeast + Water → Dough → Bread
//      cake:   Flour + 2·Egg + Sugar + Butter → Batter → Cake
//    Because there is only ONE flour, you can make bread OR cake, not both.
//
// The goal is a CAKE. Knead-dough (bread) has *higher priority* than make-batter
// (cake), so the greedy forward Engine grabs the flour for bread first and then
// can never make the cake , it halts with Bread and the goal still "open". That
// is the naive forward approach failing on an alternate path.
//
// The SAME rules, driven by the backtracking `plan()` search instead, undo the
// bread choice on the dead end and find the cake plan. See the `plan()` API and
// the planner tests/guide for that side. (Lower the "Knead dough" priority below
// "Make batter" and the greedy run succeeds too , greedy is just fragile to the
// ordering; backtracking isn't.)
// ---------------------------------------------------------------------------
export function cakeOrBread (): Grammar {
  const start = buildLarder()
  const open = { predicates: [{ key: 'status', op: 'eq' as const, value: 'open' }] }

  const achieve = rule({
    name: 'Goal reached: a Cake exists',
    description: "Goal-detection: flip the goal to 'achieved' the moment a Cake exists.",
    color: '#2f9e44',
    group: 'Goal',
    priority: 100,
    lhs: { nodes: [pn('g', 'Goal', open), pn('c', 'Cake')], edges: [] },
    rhs: { nodes: [rn('g', 'Goal', { mapFrom: 'g', setProps: { status: lit('achieved') } }), rn('c', 'Cake', { mapFrom: 'c' })], edges: [] },
  })

  const bakeCake = rule({
    name: 'Bake cake: Batter → Cake',
    description: 'Consume the Batter, produce the Cake.',
    color: '#e8590c',
    group: 'Cake',
    priority: 80,
    lhs: { nodes: [pn('k', 'Kitchen'), pn('b', 'Batter')], edges: [] },
    rhs: { nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('cake', 'Cake')], edges: [re('e', 'k', 'cake', { label: 'made' })] },
    embedding: [emb('b', 'remove')],
  })

  const bakeBread = rule({
    name: 'Bake bread: Dough → Bread',
    description: 'Consume the Dough, produce the Bread.',
    color: '#c2855b',
    group: 'Bread',
    priority: 80,
    lhs: { nodes: [pn('k', 'Kitchen'), pn('d', 'Dough')], edges: [] },
    rhs: { nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('bread', 'Bread')], edges: [re('e', 'k', 'bread', { label: 'made' })] },
    embedding: [emb('d', 'remove')],
  })

  // Knead dough is HIGHER priority than make batter , so greedy grabs the flour
  // for bread first and starves the cake. (This is the fragility being shown.)
  const kneadDough = rule({
    name: 'Knead dough: Flour + Yeast + Water → Dough',
    description: "Bread path. Consumes the (only) Flour along with Yeast and Water. Higher priority than the cake's batter step, so the greedy planner commits here first.",
    color: '#e8a87c',
    group: 'Bread',
    priority: 60,
    lhs: { nodes: [pn('k', 'Kitchen'), pn('f', 'Flour'), pn('y', 'Yeast'), pn('w', 'Water')], edges: [] },
    rhs: { nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('dough', 'Dough')], edges: [re('e', 'k', 'dough', { label: 'has' })] },
    embedding: [emb('f', 'remove'), emb('y', 'remove'), emb('w', 'remove')],
  })

  const makeBatter = rule({
    name: 'Make batter: Flour + 2·Egg + Sugar + Butter → Batter',
    description: 'Cake path. Needs the same Flour the bread wants, plus two eggs, sugar and butter. Lower priority than kneading dough.',
    color: '#f4b942',
    group: 'Cake',
    priority: 50,
    lhs: {
      nodes: [pn('k', 'Kitchen'), pn('f', 'Flour'), pn('e1', 'Egg'), pn('e2', 'Egg'), pn('s', 'Sugar'), pn('bu', 'Butter')],
      edges: [],
    },
    rhs: { nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('batter', 'Batter')], edges: [re('e', 'k', 'batter', { label: 'has' })] },
    embedding: [emb('f', 'remove'), emb('e1', 'remove'), emb('e2', 'remove'), emb('s', 'remove'), emb('bu', 'remove')],
  })

  return grammar(
    '🧭 Planner II: Cake vs Bread (paths & backtracking)',
    [achieve, bakeCake, bakeBread, kneadDough, makeBatter],
    start,
    { strategy: 'priority', maxSteps: 40, seed: 1 }
  )
}

// The larder , every ingredient is a node hung off the Kitchen. Just ONE flour,
// so bread and cake compete for it.
function buildLarder (): Graph {
  const g = emptyGraph()
  const kitchen = makeNode('Kitchen', {}, 400, 330)
  const goal = makeNode('Goal', { want: 'Cake', status: 'open' }, 400, 150)
  g.nodes.push(kitchen, goal)
  g.edges.push(makeEdge(kitchen.id, goal.id, 'wants', false))

  // ingredient label → how many, laid out in a ring around the Kitchen
  const stock: Array<[string, number]> = [
    ['Flour', 1],
    ['Egg', 2],
    ['Sugar', 1],
    ['Butter', 1],
    ['Yeast', 1],
    ['Water', 1],
  ]
  const items = stock.flatMap(([label, n]) => Array.from({ length: n }, () => label))
  items.forEach((label, i) => {
    const a = (i / items.length) * Math.PI * 2
    const node = makeNode(label, {}, 400 + Math.cos(a) * 200, 380 + Math.sin(a) * 160)
    g.nodes.push(node)
    g.edges.push(makeEdge(kitchen.id, node.id, 'has', false))
  })

  return g
}
