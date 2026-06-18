import type {
  PatternGraph,
  PatternNode,
  PatternEdge,
  PropPredicate,
  Props,
  GNode,
  GEdge,
  Match,
} from './types.ts'
import { GraphIndex } from './graph.ts'
import type { RNG } from './util.ts'

// ============================================================================
// Subgraph matching.
//
// We find occurrences of an LHS PatternGraph inside a host graph (indexed).
// The algorithm is a backtracking search (VF2/VF2++-flavoured) with:
//   * label + predicate based candidate pruning,
//   * VF2++ "infrequent-label-first" seed selection , the first pattern node
//     bound is the one with the fewest host candidates, so the search tree is
//     narrow at the top,
//   * connectivity-guided variable ordering , every subsequent pattern node is
//     reached through an already-bound neighbour, so candidate sets are just
//     "neighbours of a bound node",
//   * injective node mapping,
//   * incremental, allocation-4free edge constraint checks (we iterate the
//     index's internal id-sets directly rather than materialising arrays).
//
// An optional RNG turns the search into a uniform-ish *random first match*
// (shuffled candidate order), so the engine can apply one match per step
// without enumerating the entire match set , the difference between O(N) and
// O(matches) per rewrite on parallel-growth grammars.
// ============================================================================

export function evalPredicate (props: Props, p: PropPredicate): boolean {
  const v = props[p.key]
  switch (p.op) {
    case 'exists':
      return v !== undefined && v !== null
    case 'absent':
      return v === undefined || v === null
    case 'eq':
      return v === p.value
    case 'neq':
      return v !== p.value
    case 'gt':
      return typeof v === 'number' && typeof p.value === 'number' && v > p.value
    case 'gte':
      return typeof v === 'number' && typeof p.value === 'number' && v >= p.value
    case 'lt':
      return typeof v === 'number' && typeof p.value === 'number' && v < p.value
    case 'lte':
      return typeof v === 'number' && typeof p.value === 'number' && v <= p.value
    case 'contains':
      return typeof v === 'string' && typeof p.value === 'string' && v.includes(p.value)
    case 'regex':
      try {
        return typeof v === 'string' && new RegExp(String(p.value)).test(v)
      } catch {
        return false
      }
    case 'in':
      return Array.isArray(p.value) && (p.value as unknown[]).includes(v as never)
    default:
      return false
  }
}

function isWildLabel (pn: PatternNode): boolean {
  return !!pn.wildcard || pn.label === '*' || pn.label === ''
}

function nodeMatches (pn: PatternNode, hn: GNode): boolean {
  if (!isWildLabel(pn) && pn.label !== hn.label) return false
  const preds = pn.predicates
  if (preds) {
    for (let i = 0; i < preds.length; i++) if (!evalPredicate(hn.props, preds[i])) return false
  }
  return true
}

function edgeLabelMatches (pe: PatternEdge, he: GEdge): boolean {
  if (pe.wildcard || pe.label === '*' || pe.label === '') return true
  return pe.label === he.label
}

function edgePropsMatch (pe: PatternEdge, he: GEdge): boolean {
  const preds = pe.predicates
  if (!preds) return true
  for (let i = 0; i < preds.length; i++) if (!evalPredicate(he.props, preds[i])) return false
  return true
}

/** Does host edge `he` satisfy pattern edge `pe` given the bound orientation? */
function edgeSatisfies (pe: PatternEdge, he: GEdge, hostSource: string, hostTarget: string): boolean {
  if (!edgeLabelMatches(pe, he)) return false
  if (!edgePropsMatch(pe, he)) return false
  // A *directed* pattern edge is an orientation constraint: the host edge must
  // itself be directed AND run the same way (source→target). An *undirected* (or
  // `anyDirection`) pattern edge is "don't care about direction" , it matches a
  // host edge of either kind in either orientation. Note we must NOT relax the
  // constraint just because the *host* edge is undirected: an undirected host
  // edge has no orientation to satisfy a directed pattern, so it should never
  // match one (otherwise direction depends on the arbitrary stored src/tgt order).
  const orientationConstrained = pe.directed && !pe.anyDirection
  if (orientationConstrained) {
    return he.directed && he.source === hostSource && he.target === hostTarget
  }
  return (
    (he.source === hostSource && he.target === hostTarget) ||
    (he.source === hostTarget && he.target === hostSource)
  )
}

const EMPTY: Iterable<string> = []

interface BackEdge {
  pe: PatternEdge;
  otherIdx: number;
  thisIsSource: boolean;
}

interface CompiledPattern {
  order: PatternNode[];
  backEdges: BackEdge[][];
  patEdgeIndex: Map<string, number>;
  edgeCount: number;
}

/**
 * Compile a pattern into a binding order. `labelCount` (host label frequency)
 * lets us seed from the rarest label (VF2++). Connectivity then drives the rest.
 * Patterns are tiny, so this is cheap; we don't bother caching it.
 */
function compilePattern (pat: PatternGraph, labelCount: (n: PatternNode) => number): CompiledPattern {
  const nodeById = new Map(pat.nodes.map((n) => [n.id, n]))
  const adj = new Map<string, PatternEdge[]>()
  for (const n of pat.nodes) adj.set(n.id, [])
  for (const e of pat.edges) {
    adj.get(e.source)?.push(e)
    adj.get(e.target)?.push(e)
  }

  const remaining = new Set(pat.nodes.map((n) => n.id))
  const order: PatternNode[] = []

  // First seed: the connected-component representative with the fewest expected
  // host candidates (rarest label, most predicates). Subsequent picks prefer
  // nodes already connected to the bound set, breaking ties by fewest candidates
  // and highest degree.
  while (remaining.size) {
    let best: string | null = null
    let bestKey: [number, number, number] | null = null // [connected?, -candidates, degree]
    for (const id of remaining) {
      const node = nodeById.get(id)!
      const connected = (adj.get(id) ?? []).some(
        (e) => !remaining.has(e.source === id ? e.target : e.source)
      )
        ? 1
        : 0
      const cand = isWildLabel(node) ? Number.MAX_SAFE_INTEGER : labelCount(node)
      const deg = adj.get(id)?.length ?? 0
      const key: [number, number, number] = [connected, -cand, deg]
      if (
        bestKey === null ||
        key[0] > bestKey[0] ||
        (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))
      ) {
        bestKey = key
        best = id
      }
    }
    order.push(nodeById.get(best!)!)
    remaining.delete(best!)
  }

  const indexOf = new Map(order.map((n, i) => [n.id, i]))
  const backEdges: BackEdge[][] = order.map(() => [])
  const patEdgeIndex = new Map(pat.edges.map((e, i) => [e.id, i]))
  for (let i = 0; i < order.length; i++) {
    const n = order[i]
    for (const e of adj.get(n.id) ?? []) {
      const otherId = e.source === n.id ? e.target : e.source
      const otherIdx = indexOf.get(otherId)!
      if (otherIdx < i) backEdges[i].push({ pe: e, otherIdx, thisIsSource: e.source === n.id })
    }
  }
  return { order, backEdges, patEdgeIndex, edgeCount: pat.edges.length }
}

export interface MatchOptions {
  /** Stop after finding this many matches (0 = all). */
  limit?: number;
  /** When set, candidate order is randomised → a random first match without
   *  enumerating the whole match set. Use with limit:1 for stochastic rewriting. */
  rng?: RNG;
}

/** Find matches of `pattern` in the indexed host graph. */
export function findMatches (
  ruleId: string,
  pattern: PatternGraph,
  host: GraphIndex,
  opts: MatchOptions = {}
): Match[] {
  const results: Match[] = []
  const P = pattern.nodes.length
  if (P === 0) return results
  const labelCount = (n: PatternNode) => host.byLabel.get(n.label)?.size ?? 0
  // Cheap impossibility check: a concrete-label node with no host bucket ⇒ no match.
  for (const pn of pattern.nodes) {
    if (!isWildLabel(pn) && (host.byLabel.get(pn.label)?.size ?? 0) === 0) return results
  }
  const cp = compilePattern(pattern, labelCount)
  const limit = opts.limit ?? 0
  const rng = opts.rng

  const boundHost: (string | null)[] = new Array(P).fill(null)
  const usedHost = new Set<string>()
  const edgeBindings: (GEdge | null)[] = new Array(cp.edgeCount).fill(null)

  // Reusable scratch for collecting back-edge bindings without per-call allocs.
  const satScratch: GEdge[] = []

  function shuffle (arr: string[]): string[] {
    if (!rng) return arr
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1))
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }

  /**
   * A stream of candidate host-node ids for pattern position `pi`. Label /
   * predicate / used filtering is done in recurse so the seed stream can stay
   * lazy: for a label-seed with an RNG we walk the random-access bucket in
   * pseudo-random order *without* materialising it , so applying one match is
   * O(depth), not O(bucket size).
   */
  function candidateStream (pi: number): Iterable<string> {
    const back = cp.backEdges[pi]
    if (back.length > 0) {
      // neighbours of the first already-bound anchor (small set)
      const anchorHost = boundHost[back[0].otherIdx]!
      const inc = host.incident.get(anchorHost)
      if (!inc) return EMPTY
      const seen = new Set<string>()
      const out: string[] = []
      for (const eid of inc) {
        const e = host.edges.get(eid)
        if (!e) continue
        const otherId = e.source === anchorHost ? e.target : e.source
        if (otherId === anchorHost || seen.has(otherId)) continue
        seen.add(otherId)
        out.push(otherId)
      }
      return shuffle(out)
    }
    const pn = cp.order[pi]
    if (!isWildLabel(pn)) {
      const bucket = host.byLabel.get(pn.label)
      if (!bucket) return EMPTY
      return rng ? bucket.iterRandom(rng) : bucket
    }
    return host.nodes.keys() // wildcard seed (rare)
  }

  // Verify all back-edges of pattern node pi when bound to host node hid.
  // Returns the satisfying host edges (in satScratch) or null on failure.
  function backEdgesOk (pi: number, hid: string): GEdge[] | null {
    const back = cp.backEdges[pi]
    satScratch.length = 0
    for (let k = 0; k < back.length; k++) {
      const be = back[k]
      const otherHost = boundHost[be.otherIdx]!
      const hSource = be.thisIsSource ? hid : otherHost
      const hTarget = be.thisIsSource ? otherHost : hid
      const set = host.edgeIdsBetween(hid, otherHost)
      let found: GEdge | null = null
      if (set) {
        for (const eid of set) {
          const he = host.edges.get(eid)
          if (!he) continue
          if (edgeSatisfies(be.pe, he, hSource, hTarget)) {
            // edge-injectivity within this node's back-edges
            let dup = false
            for (let s = 0; s < satScratch.length; s++) {
              if (satScratch[s] === he) {
                dup = true
                break
              }
            }
            if (!dup) {
              found = he
              break
            }
          }
        }
      }
      if (!found) return null
      satScratch.push(found)
    }
    return satScratch
  }

  function degreeOk (pn: PatternNode, hid: string): boolean {
    return pn.exactDegree == null || host.degree(hid) === pn.exactDegree
  }

  function recurse (pi: number): boolean {
    if (limit && results.length >= limit) return true
    if (pi === P) {
      const nodeMap: Record<string, string> = {}
      for (let i = 0; i < P; i++) nodeMap[cp.order[i].id] = boundHost[i]!
      const edgeMap: Record<string, string> = {}
      for (const [eid, idx] of cp.patEdgeIndex) {
        const he = edgeBindings[idx]
        if (he) edgeMap[eid] = he.id
      }
      results.push({ ruleId, nodeMap, edgeMap })
      return false
    }
    const pn = cp.order[pi]
    const back = cp.backEdges[pi]
    for (const hid of candidateStream(pi)) {
      if (usedHost.has(hid)) continue
      const hn = host.nodes.get(hid)
      if (!hn || !nodeMatches(pn, hn)) continue
      if (!degreeOk(pn, hid)) continue
      const sat = backEdgesOk(pi, hid)
      if (sat === null) continue
      boundHost[pi] = hid
      usedHost.add(hid)
      for (let k = 0; k < back.length; k++) edgeBindings[cp.patEdgeIndex.get(back[k].pe.id)!] = sat[k]
      const done = recurse(pi + 1)
      usedHost.delete(hid)
      boundHost[pi] = null
      for (let k = 0; k < back.length; k++) edgeBindings[cp.patEdgeIndex.get(back[k].pe.id)!] = null
      if (done) return true
    }
    return false
  }

  recurse(0)
  return results
}

/** True if the pattern has at least one match (cheap early-exit). */
export function hasMatch (pattern: PatternGraph, host: GraphIndex): boolean {
  return findMatches('_probe', pattern, host, { limit: 1 }).length > 0
}

/** Find a single, randomly-chosen match (or null) without enumerating all. */
export function findOneMatch (
  ruleId: string,
  pattern: PatternGraph,
  host: GraphIndex,
  rng: RNG
): Match | null {
  const m = findMatches(ruleId, pattern, host, { limit: 1, rng })
  return m.length ? m[0] : null
}

/** Count matches up to `cap`; returns the count (≤ cap). Used for UI badges. */
export function countMatches (pattern: PatternGraph, host: GraphIndex, cap: number): number {
  return findMatches('_count', pattern, host, { limit: cap }).length
}
