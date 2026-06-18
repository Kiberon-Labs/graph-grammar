import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { plan, hasNodeLabeled } from '../src/plan.ts'
import { buildExample } from '../src/examples.ts'
import { cloneGraph } from '../src/graph.ts'
import type { Graph } from '../src/types.ts'

const has = (g: Graph, label: string) => g.nodes.some((n) => n.label === label)
const goalStatus = (g: Graph) => g.nodes.find((n) => n.label === 'Goal')?.props.status

// The "Cake vs Bread" example shares a single Flour between two recipes, and
// kneading dough (bread) outranks making batter (cake). It's the canonical case
// where greedy forward search fails but backtracking succeeds.

describe('forward (greedy) vs backtracking on competing paths', () => {
  it('greedy forward grabs the flour for bread and never makes the cake', () => {
    const g = buildExample('planner-paths')
    const eng = new Engine(g)
    eng.run()
    const out = eng.graph

    // it committed to bread with the only flour…
    expect(has(out, 'Bread')).toBe(true)
    // …so the cake is now impossible, and the goal is still open
    expect(has(out, 'Cake')).toBe(false)
    expect(goalStatus(out)).toBe('open')
  })

  it('backtracking plan() undoes the bread choice and finds the cake', () => {
    const g = buildExample('planner-paths')
    const res = plan(g, hasNodeLabeled('Cake'))

    expect(res.found).toBe(true)
    expect(has(res.graph, 'Cake')).toBe(true)
    // the plan it found is the cake recipe, and it did NOT waste flour on bread
    expect(has(res.graph, 'Bread')).toBe(false)
    const names = res.steps.map((s) => s.ruleName)
    expect(names.some((n) => /Make batter/.test(n))).toBe(true)
    expect(names.some((n) => /Bake cake/.test(n))).toBe(true)
    expect(names.some((n) => /dough|bread/i.test(n))).toBe(false)
    // it actually had to backtrack (explored more states than the 2-step plan)
    expect(res.statesExplored).toBeGreaterThan(res.steps.length)
    // frames are replayable: one more than steps, starting at the axiom and
    // ending at the goal graph
    expect(res.frames).toHaveLength(res.steps.length + 1)
    expect(has(res.frames[0], 'Cake')).toBe(false) // start has no cake
    expect(has(res.frames[res.frames.length - 1], 'Cake')).toBe(true) // last frame does
  })

  it('reports failure when the goal is genuinely unreachable', () => {
    const g = buildExample('planner-paths')
    // remove the flour entirely → neither recipe can start
    const start = cloneGraph(g.start)
    const flour = start.nodes.find((n) => n.label === 'Flour')!
    start.nodes = start.nodes.filter((n) => n.id !== flour.id)
    start.edges = start.edges.filter((e) => e.source !== flour.id && e.target !== flour.id)

    const res = plan({ ...g, start }, hasNodeLabeled('Cake'))
    expect(res.found).toBe(false)
    expect(res.steps).toHaveLength(0)
  })

  it('also solves the props-based planner (finds a plan to a Cake)', () => {
    const g = buildExample('planner')
    const res = plan(g, hasNodeLabeled('Cake'))
    expect(res.found).toBe(true)
    expect(has(res.graph, 'Cake')).toBe(true)
  })
})
