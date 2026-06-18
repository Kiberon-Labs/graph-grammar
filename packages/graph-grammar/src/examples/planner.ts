import type { Graph, Grammar } from '../types.ts'
import { pn, rn, re, emb, rule, grammar, lit, incProp } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Planner , "can I bake a cake?" as goal-directed graph rewriting.
//
// The host graph IS the world state: a `Pantry` node whose props are the FACTS
// (how many eggs / flour / sugar / butter / money you have), a `Kitchen` work
// surface, and a `Goal` node carrying the objective (`want: "Cake"`, initially
// `status: "open"`). Each rule is an ACTION with preconditions (predicates on
// the facts) and effects (props decremented, intermediate products created).
//
// Run it under the `priority` strategy and it plans forward, action by action:
//   beat eggs → cream butter+sugar → mix batter → bake → Cake → goal "achieved".
// That answers the planning question: a run that ends with the Goal "achieved"
// proves a plan exists; one that halts with the Goal still "open" proves the
// cake is impossible from the given facts.
//
// REPLANNING / RECOVERY is the second half. Cooking actions are high priority;
// `Recovery` actions (buy more, or substitute) are low priority, so they only
// fire when a recipe step is *blocked*. The start state is deliberately short
// one stick of butter , watch the planner hit the "cream" step, fail, drop to
// the recovery rule, buy butter, and carry on. Edit the Pantry mid-run (set
// eggs to 0, drain the money) and Reset/Play to see it find another route , or
// give up , exactly as the facts allow.
// ---------------------------------------------------------------------------
export function cakePlanner (): Grammar {
  const start = buildKitchen()
  const open = { predicates: [{ key: 'status', op: 'eq' as const, value: 'open' }] }

  // Goal detection , the instant a Cake exists, flip the goal to "achieved".
  // Highest priority, so success is recognised at once and the plan stops.
  const achieve = rule({
    name: 'Goal reached: a Cake exists',
    description: "Goal-detection. As soon as a Cake is on the counter, the goal flips 'open' → 'achieved' and the plan halts (every other rule is gated on the goal being open).",
    color: '#2f9e44',
    group: 'Goal',
    priority: 100,
    lhs: { nodes: [pn('g', 'Goal', open), pn('c', 'Cake')], edges: [] },
    rhs: { nodes: [rn('g', 'Goal', { mapFrom: 'g', setProps: { status: lit('achieved') } }), rn('c', 'Cake', { mapFrom: 'c' })], edges: [] },
  })

  const bake = rule({
    name: 'Bake: Batter → Cake',
    description: 'Put the batter in the oven: consume the Batter, produce the Cake.',
    color: '#e8590c',
    group: 'Recipe',
    priority: 80,
    lhs: { nodes: [pn('k', 'Kitchen'), pn('b', 'Batter')], edges: [] },
    rhs: { nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('cake', 'Cake')], edges: [re('e', 'k', 'cake', { label: 'made' })] },
    embedding: [emb('b', 'remove')], // drop the consumed Batter's edges
  })

  const mix = rule({
    name: 'Mix: eggs + creamed + flour → Batter',
    description: 'Fold the beaten eggs and the creamed butter & sugar together with a cup of flour to make Batter.',
    color: '#f08c00',
    group: 'Recipe',
    priority: 70,
    lhs: {
      nodes: [pn('k', 'Kitchen'), pn('be', 'BeatenEggs'), pn('cr', 'Creamed'), pn('p', 'Pantry', { predicates: [{ key: 'flour', op: 'gte', value: 1 }] })],
      edges: [],
    },
    rhs: {
      nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('p', 'Pantry', { mapFrom: 'p', setProps: { flour: incProp('p', 'flour', -1) } }), rn('batter', 'Batter')],
      edges: [re('e', 'k', 'batter', { label: 'in' })],
    },
    embedding: [emb('be', 'remove'), emb('cr', 'remove')],
  })

  const beat = rule({
    name: 'Beat eggs (need 2)',
    description: "Crack and beat 2 eggs. Gated on the goal still being open; won't run if beaten eggs already exist (NAC).",
    color: '#fab005',
    group: 'Recipe',
    priority: 60,
    lhs: { nodes: [pn('k', 'Kitchen'), pn('g', 'Goal', open), pn('p', 'Pantry', { predicates: [{ key: 'eggs', op: 'gte', value: 2 }] })], edges: [] },
    rhs: {
      nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('g', 'Goal', { mapFrom: 'g' }), rn('p', 'Pantry', { mapFrom: 'p', setProps: { eggs: incProp('p', 'eggs', -2) } }), rn('be', 'BeatenEggs')],
      edges: [re('e', 'k', 'be', { label: 'has' })],
    },
    nac: [{ nodes: [pn('x', 'BeatenEggs')], edges: [] }],
  })

  const cream = rule({
    name: 'Cream butter & sugar',
    description: 'Cream 1 butter with 1 sugar. This is the step that gets stuck when the butter runs out , watch Recovery kick in.',
    color: '#fab005',
    group: 'Recipe',
    priority: 60,
    lhs: {
      nodes: [pn('k', 'Kitchen'), pn('g', 'Goal', open), pn('p', 'Pantry', { predicates: [{ key: 'butter', op: 'gte', value: 1 }, { key: 'sugar', op: 'gte', value: 1 }] })],
      edges: [],
    },
    rhs: {
      nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('g', 'Goal', { mapFrom: 'g' }), rn('p', 'Pantry', { mapFrom: 'p', setProps: { butter: incProp('p', 'butter', -1), sugar: incProp('p', 'sugar', -1) } }), rn('cr', 'Creamed')],
      edges: [re('e', 'k', 'cr', { label: 'has' })],
    },
    nac: [{ nodes: [pn('x', 'Creamed')], edges: [] }],
  })

  // Recovery actions , low priority, so they only fire when a recipe step can't.
  const buyButter = rule({
    name: 'Recover: buy butter ($3)',
    description: "Butter ran out but there's money? Buy more (butter +2, money −3). Lower priority than cooking, so it only fires when the 'cream' step is blocked , the plan repairs itself, then resumes.",
    color: '#4dabf7',
    group: 'Recovery',
    priority: 30,
    lhs: { nodes: [pn('g', 'Goal', open), pn('p', 'Pantry', { predicates: [{ key: 'butter', op: 'lt', value: 1 }, { key: 'money', op: 'gte', value: 3 }] })], edges: [] },
    rhs: { nodes: [rn('g', 'Goal', { mapFrom: 'g' }), rn('p', 'Pantry', { mapFrom: 'p', setProps: { butter: incProp('p', 'butter', 2), money: incProp('p', 'money', -3) } })], edges: [] },
    nac: [{ nodes: [pn('x', 'Creamed')], edges: [] }],
  })

  const buyEggs = rule({
    name: 'Recover: buy eggs ($4)',
    description: 'Out of eggs with the goal still open? Buy half a dozen (eggs +6, money −4).',
    color: '#4dabf7',
    group: 'Recovery',
    priority: 30,
    lhs: { nodes: [pn('g', 'Goal', open), pn('p', 'Pantry', { predicates: [{ key: 'eggs', op: 'lt', value: 2 }, { key: 'money', op: 'gte', value: 4 }] })], edges: [] },
    rhs: { nodes: [rn('g', 'Goal', { mapFrom: 'g' }), rn('p', 'Pantry', { mapFrom: 'p', setProps: { eggs: incProp('p', 'eggs', 6), money: incProp('p', 'money', -4) } })], edges: [] },
    nac: [{ nodes: [pn('x', 'BeatenEggs')], edges: [] }],
  })

  const substitute = rule({
    name: 'Recover: applesauce for eggs',
    description: "No eggs and no cash, but a jar of applesauce? Substitute it (applesauce −1) to stand in for the beaten eggs. A second, different repair when buying isn't an option.",
    color: '#3bc9db',
    group: 'Recovery',
    priority: 20,
    lhs: { nodes: [pn('k', 'Kitchen'), pn('g', 'Goal', open), pn('p', 'Pantry', { predicates: [{ key: 'eggs', op: 'lt', value: 2 }, { key: 'applesauce', op: 'gte', value: 1 }] })], edges: [] },
    rhs: {
      nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('g', 'Goal', { mapFrom: 'g' }), rn('p', 'Pantry', { mapFrom: 'p', setProps: { applesauce: incProp('p', 'applesauce', -1) } }), rn('be', 'BeatenEggs')],
      edges: [re('e', 'k', 'be', { label: 'has' })],
    },
    nac: [{ nodes: [pn('x', 'BeatenEggs')], edges: [] }],
  })

  return grammar(
    '🎂 Planner: Bake a Cake (goal + recovery)',
    [achieve, bake, mix, beat, cream, buyButter, buyEggs, substitute],
    start,
    { strategy: 'priority', maxSteps: 60, seed: 1 }
  )
}

// The world state. Pantry props ARE the facts , edit them in the node inspector.
// Deliberately short one butter (but with money to buy more) so a run shows the
// recovery path without any manual change.
function buildKitchen (): Graph {
  const g = emptyGraph()
  const kitchen = makeNode('Kitchen', {}, 400, 330)
  const pantry = makeNode('Pantry', { eggs: 3, flour: 2, sugar: 2, butter: 0, milk: 1, applesauce: 1, money: 5 }, 220, 250)
  const goal = makeNode('Goal', { want: 'Cake', status: 'open' }, 580, 250)
  g.nodes.push(kitchen, pantry, goal)
  g.edges.push(makeEdge(kitchen.id, pantry.id, 'stocks', false), makeEdge(kitchen.id, goal.id, 'wants', false))
  return g
}
