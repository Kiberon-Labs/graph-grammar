import { describe, it, expect } from 'vitest'
import { GraphIndex, makeNode, makeEdge, emptyGraph } from '../src/graph.ts'
import { findMatches } from '../src/match.ts'
import { pn, pe } from '../src/builders.ts'

describe('subgraph matching', () => {
  it('matches labelled and wildcard edge patterns on an A-B-C chain', () => {
    const g = emptyGraph()
    const a = makeNode('A'); const b = makeNode('B'); const c = makeNode('C')
    g.nodes.push(a, b, c)
    g.edges.push(makeEdge(a.id, b.id, '', false), makeEdge(b.id, c.id, '', false))
    const idx = new GraphIndex(g)

    expect(findMatches('r', { nodes: [pn('x', 'A'), pn('y', 'B')], edges: [pe('e', 'x', 'y')] }, idx)).toHaveLength(1)
    expect(findMatches('r', { nodes: [pn('x', 'A'), pn('y', '*', { wildcard: true })], edges: [pe('e', 'x', 'y')] }, idx)).toHaveLength(1)
    expect(findMatches('r', { nodes: [pn('x', 'C'), pn('y', 'A')], edges: [pe('e', 'x', 'y')] }, idx)).toHaveLength(0)
    expect(findMatches('r', { nodes: [pn('x', 'A')], edges: [] }, idx)).toHaveLength(1)
  })

  it("is injective and counts automorphisms on a triangle of A's", () => {
    const g = emptyGraph()
    const xs = [makeNode('A'), makeNode('A'), makeNode('A')]
    g.nodes.push(...xs)
    g.edges.push(makeEdge(xs[0].id, xs[1].id, '', false), makeEdge(xs[1].id, xs[2].id, '', false), makeEdge(xs[2].id, xs[0].id, '', false))
    const idx = new GraphIndex(g)

    const tri = { nodes: [pn('a', 'A'), pn('b', 'A'), pn('c', 'A')], edges: [pe('e1', 'a', 'b'), pe('e2', 'b', 'c'), pe('e3', 'c', 'a')] }
    expect(findMatches('r', tri, idx)).toHaveLength(6) // 3! orderings

    const two = { nodes: [pn('a', 'A'), pn('b', 'A')], edges: [pe('e', 'a', 'b')] }
    const matches = findMatches('r', two, idx)
    expect(matches).toHaveLength(6) // 3 undirected edges Ã, 2 directions
    for (const m of matches) expect(m.nodeMap['a']).not.toBe(m.nodeMap['b'])
  })

  it('respects edge direction and anyDirection', () => {
    const g = emptyGraph()
    const a = makeNode('A'); const b = makeNode('B')
    g.nodes.push(a, b)
    g.edges.push(makeEdge(a.id, b.id, '', true)) // directed A->B
    const idx = new GraphIndex(g)

    expect(findMatches('r', { nodes: [pn('x', 'A'), pn('y', 'B')], edges: [pe('e', 'x', 'y', { directed: true })] }, idx)).toHaveLength(1)
    expect(findMatches('r', { nodes: [pn('x', 'B'), pn('y', 'A')], edges: [pe('e', 'x', 'y', { directed: true })] }, idx)).toHaveLength(0)
    expect(findMatches('r', { nodes: [pn('x', 'B'), pn('y', 'A')], edges: [pe('e', 'x', 'y', { anyDirection: true })] }, idx)).toHaveLength(1)
  })

  it('a directed pattern edge does not match an undirected host edge', () => {
    const g = emptyGraph()
    const a = makeNode('A'); const b = makeNode('B')
    g.nodes.push(a, b)
    g.edges.push(makeEdge(a.id, b.id, '', false)) // undirected A–B
    const idx = new GraphIndex(g)

    // directed pattern must NOT match the undirected host edge (either way)
    expect(findMatches('r', { nodes: [pn('x', 'A'), pn('y', 'B')], edges: [pe('e', 'x', 'y', { directed: true })] }, idx)).toHaveLength(0)
    expect(findMatches('r', { nodes: [pn('x', 'B'), pn('y', 'A')], edges: [pe('e', 'x', 'y', { directed: true })] }, idx)).toHaveLength(0)
    // an undirected pattern still matches it in both orientations
    expect(findMatches('r', { nodes: [pn('x', 'A'), pn('y', 'B')], edges: [pe('e', 'x', 'y')] }, idx)).toHaveLength(1)
    // an undirected pattern also matches a directed host edge (direction-agnostic)
    const g2 = emptyGraph()
    const c = makeNode('A'); const d = makeNode('B')
    g2.nodes.push(c, d)
    g2.edges.push(makeEdge(c.id, d.id, '', true)) // directed A->B
    expect(findMatches('r', { nodes: [pn('x', 'B'), pn('y', 'A')], edges: [pe('e', 'x', 'y')] }, new GraphIndex(g2))).toHaveLength(1)
  })

  it('honours exact-degree, predicates, and self-loops', () => {
    const g = emptyGraph()
    const hub = makeNode('A', { w: 9 }); const l1 = makeNode('A'); const l2 = makeNode('A')
    g.nodes.push(hub, l1, l2)
    g.edges.push(makeEdge(hub.id, l1.id, '', false), makeEdge(hub.id, l2.id, '', false))
    const idx = new GraphIndex(g)

    const deg1 = { nodes: [pn('x', 'A')], edges: [] }
    deg1.nodes[0].exactDegree = 1
    expect(findMatches('r', deg1, idx)).toHaveLength(2)

    const deg2 = { nodes: [pn('x', 'A')], edges: [] }
    deg2.nodes[0].exactDegree = 2
    expect(findMatches('r', deg2, idx)).toHaveLength(1)

    const pred = { nodes: [pn('x', 'A', { predicates: [{ key: 'w', op: 'gt' as const, value: 5 }] })], edges: [] }
    expect(findMatches('r', pred, idx)).toHaveLength(1)

    const sg = emptyGraph()
    const s = makeNode('S')
    sg.nodes.push(s)
    sg.edges.push(makeEdge(s.id, s.id, 'loop', true))
    expect(findMatches('r', { nodes: [pn('x', 'S')], edges: [pe('e', 'x', 'x', { label: 'loop', directed: true })] }, new GraphIndex(sg))).toHaveLength(1)
  })

  it('matches disconnected patterns as injective ordered pairs', () => {
    const g = emptyGraph()
    g.nodes.push(makeNode('A'), makeNode('A'), makeNode('B'))
    expect(findMatches('r', { nodes: [pn('a', 'A'), pn('b', 'B')], edges: [] }, new GraphIndex(g))).toHaveLength(2)
  })
})
