import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { buildExample } from '../src/examples.ts'
import { histogram } from './helpers.ts'

// The two "applied" examples make concrete claims about what they do , assert
// those behaviours, not just that they build.

describe('network: cycle condensation', () => {
  it('contracts every cyclic route into a single node while the acyclic backbone survives', () => {
    const g = buildExample('network')
    const before = histogram(g.start)
    // start: 9 routers (4 backbone + 3 loop + 2 mutual) and 2 hosts
    expect(before).toEqual({ R: 9, H: 2 })

    const eng = new Engine(g)
    eng.run()
    const after = histogram(eng.graph)

    // the 3-cycle (3 R → 1) and the 2-cycle (2 R → 1) collapse; backbone (4 R)
    // and the 2 hosts are untouched → 6 routers, 2 hosts.
    expect(after).toEqual({ R: 6, H: 2 })
    expect(eng.graph.nodes.length).toBe(8)

    // condensation is monotone: re-running from the fixpoint changes nothing.
    const steps = new Engine({ ...g, start: eng.graph }).run()
    expect(steps).toBe(0)
  })

  it('scales: the 138-node variant condenses its 36 loops to 84 nodes', () => {
    const g = buildExample('network-large')
    // 12 backbone + 18×3 loop routers + 18×2 mutual routers = 102 R; 36 hosts
    expect(histogram(g.start)).toEqual({ R: 102, H: 36 })
    expect(g.start.nodes.length).toBe(138)

    const eng = new Engine(g)
    eng.run()
    const after = histogram(eng.graph)

    // every loop (18 triangles, 18 mutual pairs) collapses to one router; the
    // spine (12) and all 36 hosts survive → 48 routers, 36 hosts.
    expect(after).toEqual({ R: 48, H: 36 })
    expect(eng.graph.nodes.length).toBe(84)
  })
})

describe('traffic: precondition-gated junction upgrades', () => {
  it('upgrades only the junctions whose preconditions match', () => {
    const g = buildExample('traffic')
    expect(histogram(g.start)).toEqual({ stop: 15 })

    const eng = new Engine(g)
    eng.run()
    const after = histogram(eng.graph)

    // two busy 4-ways → roundabouts (each grows a 4-lane ring), one busy 3-way →
    // a signal; the quiet 4-way and every low-traffic junction stay a stop.
    expect(after.roundabout).toBe(2)
    expect(after.lane).toBe(8) // 4 lanes per roundabout
    expect(after.signal).toBe(1)
    expect(after.stop).toBe(12) // 15 − 2 roundabouts − 1 signal
  })
})
