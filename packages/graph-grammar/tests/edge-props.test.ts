import { describe, it, expect } from 'vitest'
import { Engine } from '../src/engine.ts'
import { emptyGraph, makeNode, makeEdge } from '../src/graph.ts'
import { pn, pe, rn, re, rule, grammar, lit, counter, copyProp } from '../src/builders.ts'

// Verifies RHS edges can carry `setProps` , properties (literals + expressions)
// applied when an edge is created, and merged onto a preserved (`mapFrom`) edge.

describe('RHS edge setProps', () => {
  it('sets props (literal, counter, copy-from-node) on a newly created edge', () => {
    const start = emptyGraph()
    start.nodes.push(makeNode('A', { val: 'hi' }, 0, 0))

    const g = grammar(
      'edge-prop-create',
      [
        rule({
          name: 'add labelled edge with props',
          maxApplications: 1,
          lhs: { nodes: [pn('a', 'A')], edges: [] },
          rhs: {
            nodes: [rn('a', 'A', { mapFrom: 'a' }), rn('b', 'B')],
            edges: [
              re('e', 'a', 'b', {
                label: 'link',
                directed: true,
                setProps: { w: counter(), kind: lit('x'), src: copyProp('a', 'val') },
              }),
            ],
          },
        }),
      ],
      start,
      { strategy: 'priority', maxSteps: 5 }
    )

    const eng = new Engine(g)
    eng.run(5)
    const edges = eng.graph.edges
    expect(edges).toHaveLength(1)
    expect(edges[0].label).toBe('link')
    expect(edges[0].props).toEqual({ w: 1, kind: 'x', src: 'hi' })
  })

  it('merges setProps onto a preserved edge without changing its identity', () => {
    const start = emptyGraph()
    const a = makeNode('A', { tag: 'T' }, 0, 0)
    const b = makeNode('B', {}, 50, 0)
    const edge = makeEdge(a.id, b.id, 'r', true, { n: 0 })
    start.nodes.push(a, b)
    start.edges.push(edge)

    const g = grammar(
      'edge-prop-preserve',
      [
        rule({
          name: 'mark the edge seen',
          lhs: {
            // gate on `seen` being absent so the rule fires exactly once
            nodes: [pn('a', 'A'), pn('b', 'B')],
            edges: [pe('e', 'a', 'b', { label: 'r', directed: true, predicates: [{ key: 'seen', op: 'absent' }] })],
          },
          rhs: {
            nodes: [rn('a', 'A', { mapFrom: 'a' }), rn('b', 'B', { mapFrom: 'b' })],
            edges: [re('e', 'a', 'b', { label: 'r', directed: true, mapFrom: 'e', setProps: { seen: lit(true), m: copyProp('a', 'tag') } })],
          },
        }),
      ],
      start,
      { strategy: 'priority', maxSteps: 10 }
    )

    const eng = new Engine(g)
    eng.run(10)
    const edges = eng.graph.edges
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe(edge.id) // same edge, preserved
    expect(edges[0].props).toEqual({ n: 0, seen: true, m: 'T' }) // original kept + merged
  })
})
