// ============================================================================
// graph-grammar , public API barrel.
//
// This is the single entry point consumers import from:
//
//   import { Engine, rule, pn, rn, importGrammar } from "graph-grammar";
//
// The large example/showcase grammars live behind a separate subpath so they
// tree-shake away for consumers who don't want them:
//
//   import { EXAMPLES, buildExample } from "graph-grammar/examples";
//
// Internal-only helpers (e.g. LabelBucket) are intentionally not re-exported.
// ============================================================================

// --- data model (types only) ------------------------------------------------
export type {
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
  Match,
  RewriteResult,
} from './types.ts'

// --- engine, indexing & matching --------------------------------------------
export { Engine } from './engine.ts'
export { plan, hasNodeLabeled } from './plan.ts'
export type { PlanStep, PlanResult, PlanOptions } from './plan.ts'
export { GraphIndex, makeNode, makeEdge, emptyGraph, cloneGraph, graphStats } from './graph.ts'
export { evalPredicate, findMatches, hasMatch, findOneMatch, countMatches } from './match.ts'
export { applyRule } from './rewrite.ts'
export type { RewriteContext, ApplyResult } from './rewrite.ts'

// --- builders DSL -----------------------------------------------------------
export {
  pn,
  pe,
  rn,
  re,
  emb,
  rule,
  defaultEmbedding,
  grammar,
  lit,
  randInt,
  counter,
  copyProp,
  incProp,
} from './builders.ts'
export type { RuleSpec } from './builders.ts'

// --- serialization & generators ---------------------------------------------
export {
  exportGrammar,
  importGrammar,
  safeImportGrammar,
  exportGraph,
  parseGraph,
  randomGraph,
  gridGraph,
} from './serialize.ts'

// --- runtime validation schemas (zod) ---------------------------------------
export {
  PropValueSchema,
  PropsSchema,
  GNodeSchema,
  GEdgeSchema,
  GraphSchema,
  PredicateOpSchema,
  PropPredicateSchema,
  PatternNodeSchema,
  PatternEdgeSchema,
  PatternGraphSchema,
  PropExprSchema,
  RhsNodeSchema,
  RhsEdgeSchema,
  RhsGraphSchema,
  EmbeddingStrategySchema,
  EmbeddingRuleSchema,
  MorphismSchema,
  RuleSchema,
  ApplicationStrategySchema,
  GrammarConfigSchema,
  GrammarSchema,
} from './schema.ts'

// --- utilities --------------------------------------------------------------
export { uid, resetCounter, RNG, deepClone, clamp } from './util.ts'
