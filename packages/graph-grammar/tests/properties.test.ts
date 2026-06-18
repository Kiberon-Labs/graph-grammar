import { describe, it, expect } from 'vitest'
import { GraphIndex, makeNode, emptyGraph } from '../src/graph.ts'
import { findMatches } from '../src/match.ts'
import { applyRule } from '../src/rewrite.ts'
import { RNG } from '../src/util.ts'
import { pn, rn, rule, lit, counter, incProp, copyProp, randInt } from '../src/builders.ts'
import { ctx } from './helpers.ts'

describe('property expressions', () => {
  it('evaluates increment / copy / counter / literal at rewrite time', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('A', { depth: 4, name: 'root' }))
    const idx = new GraphIndex(g)
    const r = rule({
      name: 'props',
      lhs: { nodes: [pn('a', 'A')], edges: [] },
      rhs: {
        nodes: [
          rn('a', 'A', { mapFrom: 'a' }),
          rn('c', 'C', { setProps: { depth: incProp('a', 'depth', 1), tag: copyProp('a', 'name'), n: counter(), k: lit(7) } }),
        ],
        edges: [],
      },
    })
    applyRule(idx, r, findMatches(r.id, r.lhs, idx)[0], ctx())
    const child = idx.toGraph().nodes.find((n) => n.label === 'C')!
    expect(child.props.depth).toBe(5)
    expect(child.props.tag).toBe('root')
    expect(child.props.k).toBe(7)
    expect(child.props.n).toBe(1)
  })

  it('produces deterministic randInt for a fixed seed', () => {
    const mk = () => {
      const g = emptyGraph()
      g.nodes.push(makeNode('A'))
      const idx = new GraphIndex(g)
      const r = rule({ name: 'ri', lhs: { nodes: [pn('a', 'A')], edges: [] }, rhs: { nodes: [rn('a', 'A', { mapFrom: 'a', setProps: { v: randInt(0, 1_000_000) } })], edges: [] } })
      applyRule(idx, r, findMatches(r.id, r.lhs, idx)[0], { rng: new RNG(99), counter: { value: 0 } })
      return idx.toGraph().nodes[0].props.v
    }
    expect(mk()).toBe(mk())
  })
})
