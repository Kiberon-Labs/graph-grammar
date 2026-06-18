import type {
  Rule,
  PatternGraph,
  PatternNode,
  PatternEdge,
  RhsGraph,
  RhsNode,
  RhsEdge,
  Morphism,
  EmbeddingRule,
  PropPredicate,
  PropExpr,
  PropValue,
  Props,
  Grammar,
  GrammarConfig,
  Graph,
} from './types.ts'
import { uid } from './util.ts'

// ============================================================================
// Fluent-ish builders used by the example library and by the UI when creating
// fresh rules. They keep the verbose type model out of hand-written grammars.
// ============================================================================

export function pn (
  id: string,
  label: string,
  opts: { props?: Props; predicates?: PropPredicate[]; wildcard?: boolean; x?: number; y?: number } = {}
): PatternNode {
  return {
    id,
    label,
    props: opts.props ?? {},
    predicates: opts.predicates,
    wildcard: opts.wildcard,
    x: opts.x,
    y: opts.y,
  }
}

export function pe (
  id: string,
  source: string,
  target: string,
  opts: { label?: string; directed?: boolean; anyDirection?: boolean; predicates?: PropPredicate[] } = {}
): PatternEdge {
  return {
    id,
    source,
    target,
    label: opts.label ?? '',
    directed: opts.directed ?? false,
    anyDirection: opts.anyDirection,
    predicates: opts.predicates,
    props: {},
  }
}

export function rn (
  id: string,
  label: string,
  opts: { mapFrom?: string; setProps?: Record<string, PropExpr>; props?: Props; x?: number; y?: number } = {}
): RhsNode {
  return {
    id,
    label,
    mapFrom: opts.mapFrom ?? null,
    setProps: opts.setProps,
    props: opts.props ?? {},
    x: opts.x,
    y: opts.y,
  }
}

/** Right-hand side edge builder */
export function re (
  id: string,
  source: string,
  target: string,
  opts: { label?: string; directed?: boolean; mapFrom?: string; setProps?: Record<string, PropExpr>; props?: Props } = {}
): RhsEdge {
  return {
    id,
    source,
    target,
    label: opts.label ?? '',
    directed: opts.directed ?? false,
    mapFrom: opts.mapFrom ?? null,
    setProps: opts.setProps,
    props: opts.props ?? {},
  }
}

export function emb (
  lhsNodeId: string,
  strategy: EmbeddingRule['strategy'],
  opts: { targetRhsNodeId?: string; edgeLabelFilter?: string; newEdgeLabel?: string } = {}
): EmbeddingRule {
  return {
    lhsNodeId,
    strategy,
    targetRhsNodeId: opts.targetRhsNodeId ?? null,
    edgeLabelFilter: opts.edgeLabelFilter ?? null,
    newEdgeLabel: opts.newEdgeLabel ?? null,
  }
}

export interface RuleSpec {
  name: string;
  lhs: PatternGraph;
  rhs: RhsGraph;
  embedding?: EmbeddingRule[];
  nac?: PatternGraph[];
  weight?: number;
  probability?: number;
  priority?: number;
  maxApplications?: number;
  enabled?: boolean;
  description?: string;
  color?: string;
  group?: string;
}

export function rule (spec: RuleSpec): Rule {
  const morphism: Morphism[] = []
  for (const rNode of spec.rhs.nodes) {
    if (rNode.mapFrom) morphism.push({ lhsNodeId: rNode.mapFrom, rhsNodeId: rNode.id })
  }
  return {
    id: uid('rule'),
    name: spec.name,
    enabled: spec.enabled ?? true,
    weight: spec.weight ?? 1,
    probability: spec.probability ?? 1,
    priority: spec.priority ?? 0,
    maxApplications: spec.maxApplications ?? 0,
    lhs: spec.lhs,
    rhs: spec.rhs,
    morphism,
    embedding: spec.embedding ?? defaultEmbedding(spec.lhs, spec.rhs),
    nac: spec.nac,
    description: spec.description,
    color: spec.color,
    group: spec.group,
  }
}

/**
 * If the author didn't specify embedding, generate a sensible default: any LHS
 * node that is deleted (not preserved by RHS) redirects its dangling edges to
 * all newly-created RHS nodes. This keeps the host graph connected through a
 * rewrite, which is what users usually want.
 */
export function defaultEmbedding (lhs: PatternGraph, rhs: RhsGraph): EmbeddingRule[] {
  const preserved = new Set(rhs.nodes.map((n) => n.mapFrom).filter(Boolean) as string[])
  const hasNewNodes = rhs.nodes.some((n) => !n.mapFrom)
  const out: EmbeddingRule[] = []
  for (const n of lhs.nodes) {
    if (!preserved.has(n.id)) {
      out.push(emb(n.id, hasNewNodes ? 'redirectToAll' : 'remove'))
    }
  }
  return out
}

export function grammar (
  name: string,
  rules: Rule[],
  start: Graph,
  config: Partial<GrammarConfig> = {}
): Grammar {
  return {
    id: uid('gr'),
    name,
    rules,
    start,
    config: {
      strategy: config.strategy ?? 'random',
      seed: config.seed ?? 12345,
      maxSteps: config.maxSteps ?? 300,
      maxNodes: config.maxNodes ?? 0,
    },
  }
}

// convenient literal prop expressions
export const lit = (value: PropValue): PropExpr => ({
  kind: 'literal',
  value,
})
export const randInt = (min: number, max: number): PropExpr => ({ kind: 'randInt', min, max })
export const counter = (): PropExpr => ({ kind: 'counter' })
export const copyProp = (from: string, key: string): PropExpr => ({ kind: 'copy', from, key })
export const incProp = (from: string, key: string, by = 1): PropExpr => ({
  kind: 'increment',
  from,
  key,
  by,
})
