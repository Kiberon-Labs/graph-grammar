import type { Graph, Grammar, Rule } from '../types.ts'
import { pn, rn, re, emb, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Planner III , pick a dish; the planner crafts it through colliding recipes.
//
// A bigger kitchen-crafting domain. Raw ingredients are NODES hung off the
// Kitchen; recipes are rules that consume some nodes and produce an intermediate
// or a finished dish. There are five dishes you can ask for ,
//   Bread · Pancakes · Cake · Choc Cake · Cookies
// , and they COLLIDE: most of them want the scarce Flour, and Cookies, Batter
// and Frosting fight over the same eggs, sugar and butter. With this larder you
// can make any ONE dish, but only by spending the shared ingredients on the
// right sub-recipes.
//
// The dish you want is the `want` on the Goal node (pick it from the goal
// selector by the Run controls, or edit the node). Two ways to satisfy it:
//
//   • Forward, greedy ("Run to end"): Cookies has the highest priority, so the
//     engine bakes cookies until the eggs/flour/sugar/butter are gone and then
//     halts , it never makes the cake you asked for. Naive creation, goal-blind.
//
//   • Backtracking ("Find plan → …"): the same rules, searched. It backs out of
//     the cookies/bread dead-ends and finds the sub-recipes that leave enough
//     for the target dish. Change the goal and it re-plans a different route.
// ---------------------------------------------------------------------------
export function kitchenPlanner (): Grammar {
  const start = buildLarder()

  // A recipe: consume one node per `inputs` label (off the Kitchen), produce the
  // `output` dish/intermediate (attached to the Kitchen). Duplicate input labels
  // (e.g. two Eggs) match that many distinct nodes.
  const craft = (spec: { name: string; group: string; priority: number; color: string; inputs: string[]; output: string }): Rule => {
    const ins = spec.inputs.map((label, i) => ({ id: `i${i}`, label }))
    return rule({
      name: spec.name,
      description: `${spec.inputs.join(' + ')} → ${spec.output}.`,
      color: spec.color,
      group: spec.group,
      priority: spec.priority,
      lhs: { nodes: [pn('k', 'Kitchen'), ...ins.map((x) => pn(x.id, x.label))], edges: [] },
      rhs: { nodes: [rn('k', 'Kitchen', { mapFrom: 'k' }), rn('out', spec.output)], edges: [re('e', 'k', 'out', { label: 'made' })] },
      embedding: ins.map((x) => emb(x.id, 'remove')),
    })
  }

  // Priorities double as the search order: higher is tried first, so the first
  // branch the planner explores mirrors the greedy run. Cookies is highest , the
  // greedy "trap" that eats the shared eggs/flour/sugar/butter. The bread
  // intermediate (Knead dough) is lowest, so the planner doesn't make incidental
  // bread on the way to a cake.
  const rules: Rule[] = [
    // Cookies , a one-shot dish with NO intermediate. Greedy bakes these first.
    craft({ name: 'Bake cookies', group: 'Dishes', priority: 70, color: '#d9a066', inputs: ['Flour', 'Egg', 'Sugar', 'Butter'], output: 'Cookies' }),

    // finished dishes (need an intermediate first)
    craft({ name: 'Bake bread', group: 'Dishes', priority: 65, color: '#c2855b', inputs: ['Dough'], output: 'Bread' }),
    craft({ name: 'Griddle pancakes', group: 'Dishes', priority: 65, color: '#f2c14e', inputs: ['Batter', 'Milk'], output: 'Pancakes' }),
    craft({ name: 'Finish cake', group: 'Dishes', priority: 65, color: '#f783ac', inputs: ['Batter', 'Frosting'], output: 'Cake' }),
    craft({ name: 'Finish choc cake', group: 'Dishes', priority: 65, color: '#a06a3f', inputs: ['Batter', 'Ganache'], output: 'Choc Cake' }),

    // intermediates
    craft({ name: 'Make batter', group: 'Prep', priority: 60, color: '#f4b942', inputs: ['Flour', 'Egg', 'Egg', 'Sugar'], output: 'Batter' }),
    craft({ name: 'Whip frosting', group: 'Prep', priority: 58, color: '#ffd6e0', inputs: ['Sugar', 'Butter'], output: 'Frosting' }),
    craft({ name: 'Melt ganache', group: 'Prep', priority: 58, color: '#8c5a3c', inputs: ['Cocoa', 'Butter'], output: 'Ganache' }),
    craft({ name: 'Knead dough', group: 'Prep', priority: 45, color: '#e8a87c', inputs: ['Flour', 'Yeast', 'Water'], output: 'Dough' }),
  ]

  return grammar('🍰 Planner III: Pick a Dish (recipes collide)', rules, start, {
    strategy: 'priority',
    maxSteps: 40,
    seed: 1,
  })
}

// The larder: each ingredient is a node hung off the Kitchen, in scarce supply,
// plus a Goal node listing the dishes you can ask for (`options`) and the
// current target (`want`).
function buildLarder (): Graph {
  const g = emptyGraph()
  const kitchen = makeNode('Kitchen', {}, 430, 360)
  const goal = makeNode('Goal', { want: 'Cake', options: 'Bread,Pancakes,Cake,Choc Cake,Cookies', status: 'open' }, 430, 150)
  g.nodes.push(kitchen, goal)
  g.edges.push(makeEdge(kitchen.id, goal.id, 'wants', false))

  const stock: Array<[string, number]> = [
    ['Flour', 2],
    ['Egg', 2],
    ['Sugar', 2],
    ['Butter', 2],
    ['Milk', 1],
    ['Yeast', 1],
    ['Water', 1],
    ['Cocoa', 1],
  ]
  const items = stock.flatMap(([label, n]) => Array.from({ length: n }, () => label))
  items.forEach((label, i) => {
    const a = (i / items.length) * Math.PI * 2
    const node = makeNode(label, {}, 430 + Math.cos(a) * 250, 400 + Math.sin(a) * 190)
    g.nodes.push(node)
    g.edges.push(makeEdge(kitchen.id, node.id, 'has', false))
  })

  return g
}
