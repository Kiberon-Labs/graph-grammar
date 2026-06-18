// ============================================================================
// Runtime schemas for the core data model (see ./types.ts).
//
// `types.ts` stays the documented, hand-written home of the public types. This
// module mirrors the *serializable* subset of that model as zod schemas so we
// can validate untrusted input (imported grammars, pasted JSON graphs) at the
// boundary instead of casting blindly.
//
// The two are kept in lockstep by the compile-time `assertSync` checks at the
// bottom: if a schema drifts from its interface in either direction, the build
// (`tsc --noEmit`) fails.
// ============================================================================

import { z } from 'zod'
import type {
  PropValue,
  Props,
  GNode,
  GEdge,
  Graph,
  PredicateOp,
  PropPredicate,
  PatternNode,
  PatternEdge,
  PatternGraph,
  RhsNode,
  RhsEdge,
  RhsGraph,
  PropExpr,
  EmbeddingStrategy,
  EmbeddingRule,
  Rule,
  Morphism,
  ApplicationStrategy,
  GrammarConfig,
  Grammar,
} from './types.ts'

// --- primitives -------------------------------------------------------------

export const PropValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const PropsSchema = z.record(z.string(), PropValueSchema)

// --- graph elements ---------------------------------------------------------

// A node is id/label/props plus optional layout coordinates (x/y). The node
// schemas below also add `.catchall(z.unknown())` so that a renderer's transient
// physics state , force-sim pins (fx/fy) and velocity (vx/vy) , passes through
// import/export untouched, without the engine modelling it.
const NodeShape = {
  id: z.string(),
  label: z.string(),
  props: PropsSchema,
  x: z.number().optional(),
  y: z.number().optional(),
}

export const GNodeSchema = z.object(NodeShape).catchall(z.unknown())

export const GEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string(),
  props: PropsSchema,
  directed: z.boolean(),
})

export const GraphSchema = z.object({
  nodes: z.array(GNodeSchema),
  edges: z.array(GEdgeSchema),
})

// --- predicates -------------------------------------------------------------

export const PredicateOpSchema = z.enum([
  'exists',
  'absent',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'regex',
  'in',
])

export const PropPredicateSchema = z.object({
  key: z.string(),
  op: PredicateOpSchema,
  value: z.union([PropValueSchema, z.array(PropValueSchema)]).optional(),
})

// --- LHS pattern ------------------------------------------------------------

export const PatternNodeSchema = z
  .object({
    ...NodeShape,
    wildcard: z.boolean().optional(),
    predicates: z.array(PropPredicateSchema).optional(),
    exactDegree: z.number().nullable().optional(),
  })
  .catchall(z.unknown())

export const PatternEdgeSchema = GEdgeSchema.extend({
  wildcard: z.boolean().optional(),
  predicates: z.array(PropPredicateSchema).optional(),
  anyDirection: z.boolean().optional(),
})

export const PatternGraphSchema = z.object({
  nodes: z.array(PatternNodeSchema),
  edges: z.array(PatternEdgeSchema),
})

// --- RHS replacement --------------------------------------------------------

export const PropExprSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: PropValueSchema }),
  z.object({ kind: z.literal('copy'), from: z.string(), key: z.string() }),
  z.object({ kind: z.literal('randInt'), min: z.number(), max: z.number() }),
  z.object({ kind: z.literal('randFloat'), min: z.number(), max: z.number() }),
  z.object({ kind: z.literal('increment'), from: z.string(), key: z.string(), by: z.number() }),
  z.object({ kind: z.literal('counter') }),
])

export const RhsNodeSchema = z
  .object({
    ...NodeShape,
    mapFrom: z.string().nullable().optional(),
    setProps: z.record(z.string(), PropExprSchema).optional(),
  })
  .catchall(z.unknown())

export const RhsEdgeSchema = GEdgeSchema.extend({
  mapFrom: z.string().nullable().optional(),
  setProps: z.record(z.string(), PropExprSchema).optional(),
})

export const RhsGraphSchema = z.object({
  nodes: z.array(RhsNodeSchema),
  edges: z.array(RhsEdgeSchema),
})

// --- embedding --------------------------------------------------------------

export const EmbeddingStrategySchema = z.enum(['remove', 'redirectToAll', 'redirectTo'])

export const EmbeddingRuleSchema = z.object({
  lhsNodeId: z.string(),
  strategy: EmbeddingStrategySchema,
  targetRhsNodeId: z.string().nullable().optional(),
  edgeLabelFilter: z.string().nullable().optional(),
  newEdgeLabel: z.string().nullable().optional(),
})

// --- rule -------------------------------------------------------------------

export const MorphismSchema = z.object({
  lhsNodeId: z.string(),
  rhsNodeId: z.string(),
})

export const RuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  weight: z.number(),
  probability: z.number(),
  priority: z.number(),
  maxApplications: z.number(),
  lhs: PatternGraphSchema,
  rhs: RhsGraphSchema,
  morphism: z.array(MorphismSchema),
  embedding: z.array(EmbeddingRuleSchema),
  nac: z.array(PatternGraphSchema).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  group: z.string().optional(),
})

// --- grammar ----------------------------------------------------------------

export const ApplicationStrategySchema = z.enum(['random', 'priority', 'sequential', 'maximal'])

export const GrammarConfigSchema = z.object({
  strategy: ApplicationStrategySchema,
  seed: z.number(),
  maxSteps: z.number(),
  maxNodes: z.number(),
})

export const GrammarSchema = z.object({
  id: z.string(),
  name: z.string(),
  rules: z.array(RuleSchema),
  config: GrammarConfigSchema,
  start: GraphSchema,
})

// ----------------------------------------------------------------------------
// Compile-time sync: each schema's inferred type must be mutually assignable
// with its hand-written interface. Purely type-level , no runtime cost.
// ----------------------------------------------------------------------------

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type AssertSync<_T extends true> = never

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _checks = [
  AssertSync<Exact<z.infer<typeof PropValueSchema>, PropValue>>,
  AssertSync<Exact<z.infer<typeof PropsSchema>, Props>>,
  AssertSync<Exact<z.infer<typeof GNodeSchema>, GNode>>,
  AssertSync<Exact<z.infer<typeof GEdgeSchema>, GEdge>>,
  AssertSync<Exact<z.infer<typeof GraphSchema>, Graph>>,
  AssertSync<Exact<z.infer<typeof PredicateOpSchema>, PredicateOp>>,
  AssertSync<Exact<z.infer<typeof PropPredicateSchema>, PropPredicate>>,
  AssertSync<Exact<z.infer<typeof PatternNodeSchema>, PatternNode>>,
  AssertSync<Exact<z.infer<typeof PatternEdgeSchema>, PatternEdge>>,
  AssertSync<Exact<z.infer<typeof PatternGraphSchema>, PatternGraph>>,
  AssertSync<Exact<z.infer<typeof PropExprSchema>, PropExpr>>,
  AssertSync<Exact<z.infer<typeof RhsNodeSchema>, RhsNode>>,
  AssertSync<Exact<z.infer<typeof RhsEdgeSchema>, RhsEdge>>,
  AssertSync<Exact<z.infer<typeof RhsGraphSchema>, RhsGraph>>,
  AssertSync<Exact<z.infer<typeof EmbeddingStrategySchema>, EmbeddingStrategy>>,
  AssertSync<Exact<z.infer<typeof EmbeddingRuleSchema>, EmbeddingRule>>,
  AssertSync<Exact<z.infer<typeof MorphismSchema>, Morphism>>,
  AssertSync<Exact<z.infer<typeof RuleSchema>, Rule>>,
  AssertSync<Exact<z.infer<typeof ApplicationStrategySchema>, ApplicationStrategy>>,
  AssertSync<Exact<z.infer<typeof GrammarConfigSchema>, GrammarConfig>>,
  AssertSync<Exact<z.infer<typeof GrammarSchema>, Grammar>>
]
