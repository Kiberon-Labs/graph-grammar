import type { Graph } from '../src/types.ts'
import { RNG } from '../src/util.ts'
import type { RewriteContext } from '../src/rewrite.ts'

/** A deterministic rewrite context for tests. */
export const ctx = (seed = 1): RewriteContext => ({ rng: new RNG(seed), counter: { value: 0 } })

/** Node-label histogram of a graph. */
export function histogram (g: Graph): Record<string, number> {
  const h: Record<string, number> = {}
  for (const n of g.nodes) h[n.label] = (h[n.label] ?? 0) + 1
  return h
}

/** A structural fingerprint: node histogram + sorted multiset of label-typed edges. */
export function fingerprint (g: Graph): string {
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label]))
  const edges = g.edges.map((e) => `${labelOf.get(e.source)}-${e.label}->${labelOf.get(e.target)}`).sort()
  return JSON.stringify({ h: histogram(g), e: edges, n: g.nodes.length })
}
