use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

// ============================================================================
// Data model ,serde structs mirroring packages/graph-grammar/src/types.ts.
// `props` use serde_json::Value for lossless JSON fidelity (PropValue =
// string | number | boolean | null).
// ============================================================================

pub(crate) type Props = Map<String, Value>;

fn default_true() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct GNode {
    pub(crate) id: String,
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) props: Props,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) y: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct GEdge {
    pub(crate) id: String,
    pub(crate) source: String,
    pub(crate) target: String,
    #[serde(default)]
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) props: Props,
    #[serde(default = "default_true")]
    pub(crate) directed: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub(crate) struct Graph {
    #[serde(default)]
    pub(crate) nodes: Vec<GNode>,
    #[serde(default)]
    pub(crate) edges: Vec<GEdge>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct PropPredicate {
    pub(crate) key: String,
    pub(crate) op: String,
    #[serde(default)]
    pub(crate) value: Option<Value>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct PatternNode {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) wildcard: bool,
    #[serde(default)]
    pub(crate) predicates: Vec<PropPredicate>,
    #[serde(default, rename = "exactDegree")]
    pub(crate) exact_degree: Option<f64>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct PatternEdge {
    pub(crate) id: String,
    pub(crate) source: String,
    pub(crate) target: String,
    #[serde(default)]
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) predicates: Vec<PropPredicate>,
    #[serde(default)]
    pub(crate) directed: bool,
    #[serde(default)]
    pub(crate) wildcard: bool,
    #[serde(default, rename = "anyDirection")]
    pub(crate) any_direction: bool,
}

#[derive(Clone, Deserialize)]
pub(crate) struct PatternGraph {
    #[serde(default)]
    pub(crate) nodes: Vec<PatternNode>,
    #[serde(default)]
    pub(crate) edges: Vec<PatternEdge>,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[allow(dead_code)] // RandInt/RandFloat min/max are parsed but rejected in the slice
pub(crate) enum PropExpr {
    Literal { value: Value },
    Copy { from: String, key: String },
    Increment { from: String, key: String, by: f64 },
    Counter,
    RandInt { min: f64, max: f64 },
    RandFloat { min: f64, max: f64 },
}

#[derive(Clone, Deserialize)]
pub(crate) struct RhsNode {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) props: Props,
    #[serde(default)]
    pub(crate) x: Option<f64>,
    #[serde(default)]
    pub(crate) y: Option<f64>,
    #[serde(default, rename = "mapFrom")]
    pub(crate) map_from: Option<String>,
    #[serde(default, rename = "setProps")]
    pub(crate) set_props: Option<IndexMap<String, PropExpr>>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct RhsEdge {
    #[allow(dead_code)] // present for schema fidelity; new edge ids are generated
    pub(crate) id: String,
    pub(crate) source: String,
    pub(crate) target: String,
    #[serde(default)]
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) props: Props,
    #[serde(default = "default_true")]
    pub(crate) directed: bool,
    #[serde(default, rename = "mapFrom")]
    pub(crate) map_from: Option<String>,
    #[serde(default, rename = "setProps")]
    pub(crate) set_props: Option<IndexMap<String, PropExpr>>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct RhsGraph {
    #[serde(default)]
    pub(crate) nodes: Vec<RhsNode>,
    #[serde(default)]
    pub(crate) edges: Vec<RhsEdge>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct EmbeddingRule {
    #[serde(rename = "lhsNodeId")]
    pub(crate) lhs_node_id: String,
    pub(crate) strategy: String,
    #[serde(default, rename = "targetRhsNodeId")]
    pub(crate) target_rhs_node_id: Option<String>,
    #[serde(default, rename = "edgeLabelFilter")]
    pub(crate) edge_label_filter: Option<String>,
    #[serde(default, rename = "newEdgeLabel")]
    pub(crate) new_edge_label: Option<String>,
}

fn one_f64() -> f64 {
    1.0
}

/// A rule. Fields the standalone rewrite ignores (weight/probability/…) are used
/// by the [`Engine`]. Unknown fields (morphism, color, …) are dropped by serde.
#[derive(Clone, Deserialize)]
pub(crate) struct Rule {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default = "default_true")]
    pub(crate) enabled: bool,
    #[serde(default = "one_f64")]
    pub(crate) weight: f64,
    #[serde(default = "one_f64")]
    pub(crate) probability: f64,
    #[serde(default)]
    pub(crate) priority: f64,
    #[serde(default, rename = "maxApplications")]
    pub(crate) max_applications: i64,
    pub(crate) lhs: PatternGraph,
    pub(crate) rhs: RhsGraph,
    #[serde(default)]
    pub(crate) embedding: Vec<EmbeddingRule>,
    #[serde(default)]
    pub(crate) nac: Vec<PatternGraph>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct GrammarConfig {
    #[serde(default)]
    pub(crate) strategy: String,
    #[serde(default)]
    pub(crate) seed: i64,
    #[serde(default, rename = "maxSteps")]
    pub(crate) max_steps: i64,
    #[serde(default, rename = "maxNodes")]
    pub(crate) max_nodes: i64,
}

#[derive(Clone, Deserialize)]
pub(crate) struct Grammar {
    #[serde(default)]
    pub(crate) rules: Vec<Rule>,
    pub(crate) config: GrammarConfig,
    #[serde(default)]
    pub(crate) start: Graph,
}

#[derive(Serialize)]
pub(crate) struct ApplyEnvelope {
    pub(crate) applied: bool,
    pub(crate) graph: Graph,
    #[serde(rename = "createdNodes")]
    pub(crate) created_nodes: Vec<String>,
    #[serde(rename = "createdEdges")]
    pub(crate) created_edges: Vec<String>,
    #[serde(rename = "deletedNodes")]
    pub(crate) deleted_nodes: Vec<String>,
    #[serde(rename = "deletedEdges")]
    pub(crate) deleted_edges: Vec<String>,
}

pub(crate) struct MatchResult {
    // Ordered (compiled binding order) to mirror the engine's JS-object nodeMap:
    // dangling-edge collection and node deletion iterate it, so the order affects
    // the resulting node/edge insertion order when elements are created/deleted.
    pub(crate) node_map: IndexMap<String, String>, // LHS node id -> host node id
    pub(crate) edge_map: IndexMap<String, String>, // LHS edge id -> host edge id
}

/// Error carried back across the FFI boundary as `{ "error": { code, detail } }`.
pub struct ApiError {
    pub code: i32,
    pub detail: String,
}
