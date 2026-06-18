import { describe, it, expect } from 'vitest'
import { GraphIndex, makeNode, makeEdge, emptyGraph } from '../src/graph.ts'
import { findMatches } from '../src/match.ts'
import { applyRule } from '../src/rewrite.ts'
import { pn, pe, rn, re, emb, rule } from '../src/builders.ts'
import { ctx, histogram } from './helpers.ts'

function apply (idx: GraphIndex, r: ReturnType<typeof rule>) {
  applyRule(idx, r, findMatches(r.id, r.lhs, idx)[0], ctx())
}

describe('rewriting', () => {
  it('rewrites a triangle of A into a B-B-B chain (the brief example)', () => {
    const g = emptyGraph()
    const xs = [makeNode('A'), makeNode('A'), makeNode('A')]
    g.nodes.push(...xs)
    g.edges.push(makeEdge(xs[0].id, xs[1].id, '', false), makeEdge(xs[1].id, xs[2].id, '', false), makeEdge(xs[2].id, xs[0].id, '', false))
    const idx = new GraphIndex(g)
    apply(idx, rule({
      name: 'tri',
      lhs: { nodes: [pn('a', 'A'), pn('b', 'A'), pn('c', 'A')], edges: [pe('e1', 'a', 'b'), pe('e2', 'b', 'c'), pe('e3', 'c', 'a')] },
      rhs: { nodes: [rn('b1', 'B', { mapFrom: 'a' }), rn('b2', 'B', { mapFrom: 'b' }), rn('b3', 'B', { mapFrom: 'c' })], edges: [re('r1', 'b1', 'b2', { directed: true }), re('r2', 'b2', 'b3', { directed: true })] },
    }))
    const out = idx.toGraph()
    expect(histogram(out)).toEqual({ B: 3 })
    expect(out.edges).toHaveLength(2)
  })

  it('creates a new node and reconnects dangling edges (default embedding)', () => {
    const g = emptyGraph()
    const a = makeNode('A'); const x = makeNode('X'); const b = makeNode('B')
    g.nodes.push(a, x, b)
    g.edges.push(makeEdge(a.id, x.id, '', false), makeEdge(x.id, b.id, '', false))
    const idx = new GraphIndex(g)
    apply(idx, rule({ name: 'xy', lhs: { nodes: [pn('x', 'X')], edges: [] }, rhs: { nodes: [rn('y', 'Y', {})], edges: [] } }))
    const out = idx.toGraph()
    expect(histogram(out)).toEqual({ A: 1, B: 1, Y: 1 })
    const y = out.nodes.find((n) => n.label === 'Y')!
    expect(new GraphIndex(out).degree(y.id)).toBe(2)
  })

  it('drops dangling edges with embedding=remove', () => {
    const g = emptyGraph()
    const a = makeNode('A'); const x = makeNode('X'); const b = makeNode('B')
    g.nodes.push(a, x, b)
    g.edges.push(makeEdge(a.id, x.id, '', false), makeEdge(x.id, b.id, '', false))
    const idx = new GraphIndex(g)
    apply(idx, rule({ name: 'drop', lhs: { nodes: [pn('x', 'X')], edges: [] }, rhs: { nodes: [rn('y', 'Y', {})], edges: [] }, embedding: [emb('x', 'remove')] }))
    expect(idx.toGraph().edges).toHaveLength(0)
  })

  it('preserves and relabels an edge between preserved nodes', () => {
    const g = emptyGraph()
    const a = makeNode('A'); const b = makeNode('B')
    g.nodes.push(a, b)
    g.edges.push(makeEdge(a.id, b.id, 'old', true))
    const idx = new GraphIndex(g)
    apply(idx, rule({
      name: 'relabelEdge',
      lhs: { nodes: [pn('a', 'A'), pn('b', 'B')], edges: [pe('e', 'a', 'b', { label: 'old', directed: true })] },
      rhs: { nodes: [rn('a', 'A', { mapFrom: 'a' }), rn('b', 'B', { mapFrom: 'b' })], edges: [re('e', 'a', 'b', { label: 'new', directed: true, mapFrom: 'e' })] },
    }))
    const out = idx.toGraph()
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0].label).toBe('new')
  })
})
