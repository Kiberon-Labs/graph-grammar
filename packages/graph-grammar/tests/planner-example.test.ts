import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { buildExample } from '../src/examples.ts'
import { histogram } from './helpers.ts'
import type { Graph } from '../src/types.ts'

// The planner answers "can I bake a cake from these facts?" by forward search:
// a run that ends with the Goal node "achieved" found a plan; one that halts
// with it still "open" proves the cake is impossible. Recovery rules repair the
// plan when an ingredient runs out.

const goalStatus = (g: Graph) => g.nodes.find((n) => n.label === 'Goal')?.props.status
const pantry = (g: Graph) => g.nodes.find((n) => n.label === 'Pantry')!.props
const hasCake = (g: Graph) => g.nodes.some((n) => n.label === 'Cake')

describe('planner: bake a cake', () => {
  it('plans to the goal, recovering from the missing butter by buying it', () => {
    const g = buildExample('planner')
    // start facts: enough of everything except butter (0), but money to buy it
    expect(pantry(g.start)).toMatchObject({ butter: 0, money: 5, eggs: 3 })
    expect(goalStatus(g.start)).toBe('open')

    const eng = new Engine(g)
    eng.run()
    const out = eng.graph

    // a plan was found: a Cake exists and the goal is achieved
    expect(hasCake(out)).toBe(true)
    expect(goalStatus(out)).toBe('achieved')
    // recovery actually happened: butter was bought (money spent from 5 → 2)
    expect(pantry(out).money).toBe(2)
    // exactly one cake, and the run reached a fixpoint (re-running does nothing)
    expect(histogram(out).Cake).toBe(1)
    expect(new Engine({ ...g, start: out }).run()).toBe(0)
  })

  it('detects when the cake is impossible (no butter, no money to recover)', () => {
    const g = buildExample('planner')
    const p = pantry(g.start)
    p.money = 0 // can't buy the missing butter, and there's no butter substitute
    const eng = new Engine(g)
    eng.run()
    const out = eng.graph

    expect(hasCake(out)).toBe(false)
    expect(goalStatus(out)).toBe('open') // halted without a plan → not achievable
  })

  it('recovers a different way: substitutes applesauce when out of eggs and cash', () => {
    const g = buildExample('planner')
    const p = pantry(g.start)
    p.eggs = 0 // no eggs…
    p.money = 2 // …and not enough cash to buy eggs ($4) , but butter ($3) is still affordable
    p.butter = 1 // give butter so the only shortfall is eggs (covered by applesauce)
    p.applesauce = 1
    const eng = new Engine(g)
    eng.run()
    const out = eng.graph

    expect(goalStatus(out)).toBe('achieved')
    expect(hasCake(out)).toBe(true)
    // the applesauce substitute was used (consumed), not an egg purchase
    expect(pantry(out).applesauce).toBe(0)
    expect(pantry(out).eggs).toBe(0)
  })
})
