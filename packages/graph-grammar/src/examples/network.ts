import type { Grammar } from '../types.ts'
import { grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'
import { condensationRules } from './_condensation-rules.ts'

// ---------------------------------------------------------------------------
// Network optimisation , cycle condensation.
//
// A directed network accumulates redundant *cyclic routes*: mutual links
// (A⇄B) and routing loops (A→B→C→A) that waste capacity and can trap packets.
// Two rules detect and collapse them , each cycle is contracted into a single
// node that INHERITS the cycle's outside connections (via redirectTo embedding),
// while the acyclic backbone is left untouched. This is exactly the
// strongly-connected-component condensation a routing layer applies to remove
// loops, expressed as two local graph-rewrite rules.
// ---------------------------------------------------------------------------
export function networkCondensation (): Grammar {
  const start = emptyGraph()
  const node = (label: string, x: number, y: number): string => {
    const n = makeNode(label, {}, x, y)
    start.nodes.push(n)
    return n.id
  }
  const link = (s: string, t: string) => start.edges.push(makeEdge(s, t, '', true)) // directed route

  // Acyclic backbone , a simple delivery path. It has no cycles, so neither rule
  // ever matches it: it stays exactly as-is.
  const s = node('R', 110, 110)
  const r1 = node('R', 110, 250)
  const r2 = node('R', 110, 390)
  const r3 = node('R', 110, 530)
  link(s, r1)
  link(r1, r2)
  link(r2, r3)

  // A 3-node routing loop hanging off r1, serving one host , the loop's outside
  // edges (in from r1, out to the host) must survive the contraction.
  const c1 = node('R', 400, 170)
  const c2 = node('R', 570, 250)
  const c3 = node('R', 430, 360)
  link(c1, c2)
  link(c2, c3)
  link(c3, c1) // the loop
  link(r1, c1) // enters the loop from the backbone
  link(c2, node('H', 740, 220)) // the loop serves a host

  // A 2-node mutual link (M1⇄M2) off r3, also serving a host.
  const m1 = node('R', 400, 500)
  const m2 = node('R', 570, 500)
  link(m1, m2)
  link(m2, m1) // mutual route
  link(r3, m1)
  link(m2, node('H', 740, 500))

  const { contractLoop, collapseMutual } = condensationRules()

  return grammar('Network · Cycle Condensation', [contractLoop, collapseMutual], start, {
    strategy: 'priority',
    maxSteps: 40,
    seed: 5,
  })
}
