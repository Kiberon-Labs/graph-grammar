import type {
  Rule,
  Match,
  PropExpr,
  PropValue,
  Props,
  GEdge,
  EmbeddingRule,
} from './types.ts'
import { GraphIndex, LabelBucket, makeNode, makeEdge } from './graph.ts'
import { RNG } from './util.ts'

// ============================================================================
// Rewriting (the "double pushout"-flavoured rewrite step, simplified).
//
// Given a host GraphIndex, a Rule, and a Match, produce the rewritten graph
// in place on the index. We follow these phases:
//   1. Resolve which LHS nodes are *preserved* (referenced by a RHS node via
//      mapFrom) versus *deleted*.
//   2. Compute RHS-node -> host-node resolution (preserved → existing host
//      node, created → fresh node).
//   3. Collect dangling edges of deleted LHS-matched nodes and apply embedding.
//   4. Delete matched edges/nodes that are not preserved.
//   5. Relabel / apply property mutations to preserved nodes.
//   6. Create new RHS nodes and edges.
// ============================================================================

export interface RewriteContext {
  rng: RNG;
  /** global counter for the `counter` PropExpr. */
  counter: { value: number };
}

function evalExpr (
  expr: PropExpr,
  ctx: RewriteContext,
  host: GraphIndex,
  nodeMap: Record<string, string>
): PropValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value
    case 'copy': {
      const hid = nodeMap[expr.from]
      const n = hid ? host.nodes.get(hid) : undefined
      return n ? (n.props[expr.key] ?? null) : null
    }
    case 'increment': {
      const hid = nodeMap[expr.from]
      const n = hid ? host.nodes.get(hid) : undefined
      const base = n && typeof n.props[expr.key] === 'number' ? (n.props[expr.key] as number) : 0
      return base + expr.by
    }
    case 'randInt':
      return ctx.rng.int(expr.min, expr.max)
    case 'randFloat':
      return ctx.rng.float(expr.min, expr.max)
    case 'counter':
      return ++ctx.counter.value
    default:
      return null
  }
}

function applySetProps (
  base: Props,
  setProps: Record<string, PropExpr> | undefined,
  ctx: RewriteContext,
  host: GraphIndex,
  nodeMap: Record<string, string>
): Props {
  if (!setProps) return base
  const out: Props = { ...base }
  for (const [k, expr] of Object.entries(setProps)) {
    out[k] = evalExpr(expr, ctx, host, nodeMap)
  }
  return out
}

export interface ApplyResult {
  createdNodes: string[];
  createdEdges: string[];
  deletedNodes: string[];
  deletedEdges: string[];
}

/**
 * Apply `rule` at `match` to `host` (mutating the index). Returns the set of
 * changed element ids for highlighting/animation.
 */
export function applyRule (
  host: GraphIndex,
  rule: Rule,
  match: Match,
  ctx: RewriteContext
): ApplyResult {
  const nodeMap = match.nodeMap // LHS node id -> host node id
  const created: string[] = []
  const createdEdges: string[] = []
  const deletedNodes: string[] = []
  const deletedEdges: string[] = []

  // 1. Which LHS nodes are preserved?
  const preservedLhs = new Set<string>()
  for (const rn of rule.rhs.nodes) if (rn.mapFrom) preservedLhs.add(rn.mapFrom)

  const matchedHostNodes = new Set(Object.values(nodeMap))

  // 2. RHS node -> host node resolution. Build it before edge work.
  const rhsToHost = new Map<string, string>()

  // Preserved nodes first (relabel + props).
  for (const rn of rule.rhs.nodes) {
    if (rn.mapFrom && nodeMap[rn.mapFrom]) {
      const hid = nodeMap[rn.mapFrom]
      const hn = host.nodes.get(hid)
      if (hn) {
        // relabel if RHS gives a concrete (non-empty) label different from host
        if (rn.label && rn.label !== '*' && rn.label !== hn.label) {
          // label change requires reindexing in byLabel
          host.byLabel.get(hn.label)?.delete(hid)
          hn.label = rn.label
          let bucket = host.byLabel.get(hn.label)
          if (!bucket) host.byLabel.set(hn.label, (bucket = new LabelBucket()))
          bucket.add(hid)
        }
        hn.props = applySetProps(hn.props, rn.setProps, ctx, host, nodeMap)
        rhsToHost.set(rn.id, hid)
      }
    }
  }

  // 3. Dangling edges of soon-to-be-deleted nodes → embedding.
  const lhsDeleted: string[] = []
  for (const [lhsId, hid] of Object.entries(nodeMap)) {
    if (!preservedLhs.has(lhsId)) lhsDeleted.push(hid)
  }

  // matched host edge ids (so we don't treat them as "external" dangling edges)
  const matchedHostEdgeIds = new Set(Object.values(match.edgeMap))

  // Collect dangling edges grouped by which LHS node caused them.
  interface Dangling {
    edge: GEdge;
    lhsNodeId: string;
    externalNodeId: string;
    danglingIsSource: boolean; // is the deleted node the source side?
  }
  const danglings: Dangling[] = []
  const lhsByHost = new Map<string, string>()
  for (const [lhsId, hid] of Object.entries(nodeMap)) lhsByHost.set(hid, lhsId)

  for (const lhsId of Object.keys(nodeMap)) {
    if (preservedLhs.has(lhsId)) continue
    const hid = nodeMap[lhsId]
    for (const e of host.incidentEdges(hid)) {
      if (matchedHostEdgeIds.has(e.id)) continue // internal to match, handled by delete
      const otherId = e.source === hid ? e.target : e.source
      // If the other endpoint is also a deleted matched node, this edge simply dies.
      if (matchedHostNodes.has(otherId) && !preservedLhs.has(lhsByHost.get(otherId) ?? '')) {
        continue
      }
      danglings.push({
        edge: e,
        lhsNodeId: lhsId,
        externalNodeId: otherId,
        danglingIsSource: e.source === hid,
      })
    }
  }

  // 6a. Create new RHS nodes (those without a mapFrom). Seed their layout near
  //     the centroid of the match so a renderer has a sensible starting point
  //     (positions are optional layout metadata; physics is the renderer's job).
  let cx = 0
  let cy = 0
  let cn = 0
  for (const hid of matchedHostNodes) {
    const hn = host.nodes.get(hid)
    if (hn && hn.x != null && hn.y != null) {
      cx += hn.x
      cy += hn.y
      cn++
    }
  }
  if (cn) {
    cx /= cn
    cy /= cn
  }

  for (const rn of rule.rhs.nodes) {
    if (rn.mapFrom && nodeMap[rn.mapFrom]) continue // preserved, already done
    const props = applySetProps(rn.props ?? {}, rn.setProps, ctx, host, nodeMap)
    const jitter = () => (ctx.rng.next() - 0.5) * 40
    const node = makeNode(
      rn.label && rn.label !== '*' ? rn.label : 'node',
      props,
      cn ? cx + jitter() : (rn.x ?? jitter()),
      cn ? cy + jitter() : (rn.y ?? jitter())
    )
    host.addNode(node)
    rhsToHost.set(rn.id, node.id)
    created.push(node.id)
  }

  // 4. Delete matched edges that are not preserved by RHS.
  const preservedHostEdges = new Set<string>()
  for (const re of rule.rhs.edges) {
    if (re.mapFrom && match.edgeMap[re.mapFrom]) {
      preservedHostEdges.add(match.edgeMap[re.mapFrom])
    }
  }
  for (const hostEdgeId of Object.values(match.edgeMap)) {
    if (!preservedHostEdges.has(hostEdgeId)) {
      if (host.edges.has(hostEdgeId)) {
        host.removeEdge(hostEdgeId)
        deletedEdges.push(hostEdgeId)
      }
    }
  }

  // 5/3. Apply embedding for dangling edges, then delete the LHS-deleted nodes.
  const embByLhs = new Map<string, EmbeddingRule>()
  for (const er of rule.embedding) embByLhs.set(er.lhsNodeId, er)

  for (const d of danglings) {
    const er = embByLhs.get(d.lhsNodeId)
    const strategy = er?.strategy ?? 'remove'
    if (er?.edgeLabelFilter && d.edge.label !== er.edgeLabelFilter) {
      // not governed: default remove
      continue
    }
    if (strategy === 'remove') continue
    const newLabel = er?.newEdgeLabel || d.edge.label
    const targets: string[] = []
    if (strategy === 'redirectTo' && er?.targetRhsNodeId) {
      const h = rhsToHost.get(er.targetRhsNodeId)
      if (h) targets.push(h)
    } else if (strategy === 'redirectToAll') {
      for (const id of created) targets.push(id)
    }
    for (const t of targets) {
      const src = d.danglingIsSource ? t : d.externalNodeId
      const tgt = d.danglingIsSource ? d.externalNodeId : t
      const ne = makeEdge(src, tgt, newLabel, d.edge.directed, { ...d.edge.props })
      host.addEdge(ne)
      createdEdges.push(ne.id)
    }
  }

  // Now delete the LHS-deleted host nodes (removes remaining incident edges).
  for (const hid of lhsDeleted) {
    if (host.nodes.has(hid)) {
      for (const e of host.incidentEdges(hid)) {
        if (host.edges.has(e.id)) deletedEdges.push(e.id)
      }
      host.removeNode(hid)
      deletedNodes.push(hid)
    }
  }

  // 6b. Create new RHS edges (not preserved). Resolve endpoints via rhsToHost.
  for (const re of rule.rhs.edges) {
    if (re.mapFrom && preservedHostEdges.has(match.edgeMap[re.mapFrom] ?? '')) {
      // preserved edge: optionally relabel and merge any setProps onto it.
      const hostId = match.edgeMap[re.mapFrom]
      const he = host.edges.get(hostId)
      if (he) {
        if (re.label && re.label !== '*' && re.label !== he.label) he.label = re.label
        he.props = applySetProps(he.props, re.setProps, ctx, host, nodeMap)
      }
      continue
    }
    const s = rhsToHost.get(re.source)
    const t = rhsToHost.get(re.target)
    if (!s || !t) continue // endpoint not resolvable (shouldn't happen)
    const props = applySetProps({ ...re.props }, re.setProps, ctx, host, nodeMap)
    const ne = makeEdge(s, t, re.label === '*' ? '' : re.label, re.directed, props)
    host.addEdge(ne)
    createdEdges.push(ne.id)
  }

  return { createdNodes: created, createdEdges, deletedNodes, deletedEdges }
}
