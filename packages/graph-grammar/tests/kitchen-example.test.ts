import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { plan, hasNodeLabeled } from '../src/plan.ts'
import { buildExample } from '../src/examples.ts'
import { cloneGraph } from '../src/graph.ts'
import type { Graph } from '../src/types.ts'

const has = (g: Graph, label: string) => g.nodes.some((n) => n.label === label)
const count = (g: Graph, label: string) => g.nodes.filter((n) => n.label === label).length

describe('kitchen: pick a dish (colliding recipes)', () => {
  it('greedy forward bakes cookies and never reaches the asked-for dish', () => {
    const g = buildExample('kitchen')
    const eng = new Engine(g)
    eng.run()
    const out = eng.graph

    // highest-priority Cookies eats the shared eggs/flour/sugar/butter…
    expect(count(out, 'Cookies')).toBe(2)
    // …so none of the intermediate-based dishes get made
    for (const dish of ['Cake', 'Choc Cake', 'Pancakes', 'Bread', 'Batter', 'Dough']) {
      expect(has(out, dish)).toBe(false)
    }
  })

  it('backtracking can make every dish on the menu', () => {
    const menu = ['Bread', 'Pancakes', 'Cake', 'Choc Cake', 'Cookies']
    for (const dish of menu) {
      const g = buildExample('kitchen')
      const res = plan(g, hasNodeLabeled(dish))
      expect(res.found, `should find a plan for ${dish}`).toBe(true)
      expect(has(res.graph, dish)).toBe(true)
      // frames are replayable and end at the dish
      expect(res.frames.length).toBe(res.steps.length + 1)
      expect(has(res.frames[res.frames.length - 1], dish)).toBe(true)
    }
  })

  it('planning the cake actually requires backtracking (out of the cookies/bread dead-ends)', () => {
    const g = buildExample('kitchen')
    const res = plan(g, hasNodeLabeled('Cake'))
    expect(res.found).toBe(true)
    // it explored more states than the final plan length → it backtracked
    expect(res.statesExplored).toBeGreaterThan(res.steps.length)
    // the cake plan made a Batter and Frosting and did NOT waste flour on bread
    const names = res.steps.map((s) => s.ruleName)
    expect(names.some((n) => /batter/i.test(n))).toBe(true)
    expect(names.some((n) => /frosting/i.test(n))).toBe(true)
    expect(has(res.graph, 'Bread')).toBe(false)
  })

  it('reports failure when the dish is unreachable (no flour at all)', () => {
    const g = buildExample('kitchen')
    const start = cloneGraph(g.start)
    const flourIds = new Set(start.nodes.filter((n) => n.label === 'Flour').map((n) => n.id))
    start.nodes = start.nodes.filter((n) => !flourIds.has(n.id))
    start.edges = start.edges.filter((e) => !flourIds.has(e.source) && !flourIds.has(e.target))

    const res = plan({ ...g, start }, hasNodeLabeled('Cake'))
    expect(res.found).toBe(false)
  })
})
