// ============================================================================
// Core data model for the graph grammar system.
//
// A *host graph* is the graph being rewritten. A *grammar* is an ordered set of
// *rules*. Each rule has a left-hand side (LHS, the pattern to match) and a
// right-hand side (RHS, the replacement). A *morphism* maps LHS elements to RHS
// elements; LHS nodes that are also present in the RHS (i.e. mapped) are
// *preserved*, unmapped LHS nodes are *deleted*, and unmapped RHS nodes are
// *created*.
// ============================================================================

export type PropValue = string | number | boolean | null
export type Props = Record<string, PropValue>

/**
 * A node in any graph (host, LHS, or RHS).
 *
 * Carries semantic data , `id`, `label`, user `props` , plus optional layout
 * coordinates (`x`/`y`), the way graph interchange formats (GraphML, GEXF) do.
 * Physics state , force-sim pins and velocity , is deliberately NOT here: it is
 * pure renderer runtime, owned by the editor's own positioned-node type. The
 * JSON schemas pass such extra fields through untouched (see schema.ts) so a
 * renderer's transient state doesn't get destroyed on import/export.
 */
export interface GNode {
  id: string;
  /** The symbol / type / label of the node. The primary matching key. */
  label: string;
  /** Arbitrary user properties used for advanced predicate matching. */
  props: Props;
  /** Optional layout position. */
  x?: number;
  y?: number;
}

/** A (possibly directed) edge. */
export interface GEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  props: Props;
  directed: boolean;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

// ---------------------------------------------------------------------------
// Predicates for advanced property matching.
// ---------------------------------------------------------------------------

export type PredicateOp =
  | 'exists'
  | 'absent'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'regex'
  | 'in'

export interface PropPredicate {
  key: string;
  op: PredicateOp;
  value?: PropValue | PropValue[];
}

/**
 * A node in an LHS pattern. In addition to a label it can carry predicates and
 * a wildcard flag. `label === "*"` (or wildcard true) matches any label.
 */
export interface PatternNode extends GNode {
  wildcard?: boolean;
  predicates?: PropPredicate[];
  /**
   * If true, this pattern node must NOT be adjacent to anything outside the
   * match beyond what the pattern specifies. Used for context-sensitive rules.
   */
  exactDegree?: number | null;
}

export interface PatternEdge extends GEdge {
  wildcard?: boolean;
  predicates?: PropPredicate[];
  /** If true, direction is ignored when matching this edge. */
  anyDirection?: boolean;
}

export interface PatternGraph {
  nodes: PatternNode[];
  edges: PatternEdge[];
}

// ---------------------------------------------------------------------------
// RHS , the replacement graph. RHS nodes/edges may reference an LHS element id
// via `mapFrom` meaning "this is the same element, preserved/relabelled".
// ---------------------------------------------------------------------------

export interface RhsNode extends GNode {
  /** id of the LHS node this preserves, if any. */
  mapFrom?: string | null;
  /**
   * Optional property mutations applied when this node is created/preserved.
   * Supports literal values and a few expressions (see rewrite.ts).
   */
  setProps?: Record<string, PropExpr>;
}

export interface RhsEdge extends GEdge {
  mapFrom?: string | null;
  /**
   * Optional property mutations applied when this edge is created or preserved.
   * Mirrors RhsNode.setProps: literals plus the same expressions (copy from a
   * bound LHS node, counter, randInt …), evaluated at rewrite time. On a
   * preserved (`mapFrom`) edge the values are merged onto the existing props.
   */
  setProps?: Record<string, PropExpr>;
}

export interface RhsGraph {
  nodes: RhsNode[];
  edges: RhsEdge[];
}

/** A property expression evaluated at rewrite time. */
export type PropExpr =
  | { kind: 'literal'; value: PropValue }
  | { kind: 'copy'; from: string; key: string } // copy from a bound LHS node id
  | { kind: 'randInt'; min: number; max: number }
  | { kind: 'randFloat'; min: number; max: number }
  | { kind: 'increment'; from: string; key: string; by: number }
  | { kind: 'counter' } // global monotonically increasing counter

// ---------------------------------------------------------------------------
// Edge embedding / gluing instructions. When an LHS node is deleted but had
// edges to the surrounding host graph ("dangling" edges), the embedding rules
// say how to reconnect them.
// ---------------------------------------------------------------------------

export type EmbeddingStrategy =
  | 'remove' // drop dangling edges (default for deleted nodes)
  | 'redirectToAll' // reconnect every dangling edge to all RHS-new nodes
  | 'redirectTo' // reconnect dangling edges to a specific RHS node

export interface EmbeddingRule {
  /** LHS node id whose dangling edges this rule governs. */
  lhsNodeId: string;
  strategy: EmbeddingStrategy;
  /** RHS node id to redirect to (for redirectTo). */
  targetRhsNodeId?: string | null;
  /** Only reconnect dangling edges whose label matches (optional). */
  edgeLabelFilter?: string | null;
  /** Keep the original edge label, or relabel reconnected edges. */
  newEdgeLabel?: string | null;
}

// ---------------------------------------------------------------------------
// A rule.
// ---------------------------------------------------------------------------

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** Relative selection weight for stochastic application. */
  weight: number;
  /** Probability [0..1] that a found match is actually applied. */
  probability: number;
  /** Priority , higher priority rules are tried first in priority mode. */
  priority: number;
  /** Maximum times this rule may fire in a single run (0 = unlimited). */
  maxApplications: number;
  lhs: PatternGraph;
  rhs: RhsGraph;
  /** node id -> node id morphism is implicit via RhsNode.mapFrom, but we keep
   *  an explicit list too for the UI's connector lines. */
  morphism: Morphism[];
  embedding: EmbeddingRule[];
  /** Negative application conditions: extra subgraphs that must NOT exist. */
  nac?: PatternGraph[];
  description?: string;
  color?: string;
  /** Optional display grouping for the rule list (e.g. a reaction phase).
   *  Purely organisational , it does not affect matching or application order. */
  group?: string;
}

export interface Morphism {
  lhsNodeId: string;
  rhsNodeId: string;
}

// ---------------------------------------------------------------------------
// Grammar , the whole rule set plus run configuration.
// ---------------------------------------------------------------------------

export type ApplicationStrategy =
  | 'random' // pick a random enabled rule weighted, apply one random match
  | 'priority' // try rules in priority order, first applicable wins
  | 'sequential' // go through rules in list order each step
  | 'maximal' // apply all non-overlapping matches of one rule at once

export interface GrammarConfig {
  strategy: ApplicationStrategy;
  /** RNG seed for reproducible stochastic runs. */
  seed: number;
  /** Stop after this many rewrite steps (safety bound). */
  maxSteps: number;
  /** Stop when host graph reaches this many nodes (0 = no bound). */
  maxNodes: number;
}

export interface Grammar {
  id: string;
  name: string;
  rules: Rule[];
  config: GrammarConfig;
  /** Starting graph (axiom). */
  start: Graph;
}

// ---------------------------------------------------------------------------
// Match result.
// ---------------------------------------------------------------------------

export interface Match {
  ruleId: string;
  /** LHS node id -> host node id. */
  nodeMap: Record<string, string>;
  /** LHS edge id -> host edge id. */
  edgeMap: Record<string, string>;
}

export interface RewriteResult {
  applied: boolean;
  ruleId?: string;
  match?: Match;
  /** ids of nodes created in this step (for animation/highlight). */
  createdNodes: string[];
  createdEdges: string[];
  deletedNodes: string[];
  deletedEdges: string[];
}
