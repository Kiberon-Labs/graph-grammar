import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { falloutQuests, questToGraph } from '../src/examples/fallout.ts'
import { FALLOUT_QUESTS } from '../src/examples/fallout-quests.ts'
import type { Graph } from '../src/types.ts'

const byLabel = (g: Graph, l: string) => g.nodes.filter((n) => n.label === l)
const edgesByLabel = (g: Graph, l: string) => g.edges.filter((e) => e.label === l)
const findQuest = (title: string) => FALLOUT_QUESTS.find((q) => q.title === title)!

describe('Fallout quest-chain modelling', () => {
  it("models a quest with an optional branch + terminal (Ant Misbehavin')", () => {
    const g = questToGraph(findQuest("Ant Misbehavin'"))
    expect(byLabel(g, 'Quest')).toHaveLength(1) // the giver / chain head
    expect(byLabel(g, 'Stage')).toHaveLength(2) // 15, 20 (mandatory)
    expect(byLabel(g, 'Optional')).toHaveLength(3) // 35, 40, 42
    expect(byLabel(g, 'End')).toHaveLength(1) // 45 (finished)
    expect(byLabel(g, 'Fail')).toHaveLength(0)
    // the optional run branches off once and rejoins once → a diamond
    expect(edgesByLabel(g, 'optional')).toHaveLength(1)
    expect(edgesByLabel(g, 'rejoin')).toHaveLength(1)
  })

  it('models multiple endings as terminals fanning off one stage (Veni, Vidi, Vici)', () => {
    const g = questToGraph(findQuest('Veni, Vidi, Vici'))
    const ends = byLabel(g, 'End')
    expect(ends).toHaveLength(2) // "driven off" vs "killed"
    // both terminals hang off the same mandatory stage
    const sources = new Set(g.edges.filter((e) => ends.some((t) => t.id === e.target)).map((e) => e.source))
    expect(sources.size).toBe(1)
  })

  it('models a failure terminal (A Loose End)', () => {
    const g = questToGraph(findQuest('A Loose End'))
    expect(byLabel(g, 'Fail')).toHaveLength(1) // "Quest failed"
    expect(byLabel(g, 'End')).toHaveLength(1) // "Quest complete"
    expect(byLabel(g, 'Optional').length).toBeGreaterThan(0)
  })

  it('every modelled chain is rooted at its giver and reaches a terminal', () => {
    for (const q of FALLOUT_QUESTS) {
      const g = questToGraph(q)
      expect(byLabel(g, 'Quest')).toHaveLength(1)
      expect(byLabel(g, 'End').length + byLabel(g, 'Fail').length).toBeGreaterThan(0)
    }
  })

  it('the playthrough walks every chain to a terminal and consumes its token', () => {
    const grammar = falloutQuests()
    const eng = new Engine(grammar)
    eng.run(5000)
    const g = eng.graph
    // no tokens left , each was consumed at the terminal it reached
    expect(byLabel(g, 'Token')).toHaveLength(0)
    // exactly one terminal reached per quest (one token each)
    const reached = g.nodes.filter((n) => (n.label === 'End' || n.label === 'Fail') && n.props.reached === true)
    expect(reached).toHaveLength(FALLOUT_QUESTS.length)
    // and progress was actually recorded along the spine
    expect(g.nodes.some((n) => n.props.visited === true)).toBe(true)
  })
})
