use crate::graph::Host;
use crate::matching::find_one_match;
use crate::rewrite::apply_rule_at;
use crate::rng::Rng;
use crate::schema::{parse_validated, schema_check};
use crate::types::{ApiError, ApplyEnvelope, Graph, Rule};

// ============================================================================
// Public Rust API (used by the integration tests) + the C ABI on top of it.
// ============================================================================

fn apply_inner(rule_json: &str, graph_json: &str, mut rng: Option<Rng>) -> Result<String, ApiError> {
    let rule: Rule = parse_validated(rule_json, schema_check::rule(), "rule")?;
    let graph: Graph = parse_validated(graph_json, schema_check::graph(), "graph")?;

    let mut host = Host::from_graph(graph);
    // Match (stochastic when seeded) and rewrite share the same RNG state, in
    // that order ,exactly as Engine.step composes findOneMatch + applyRule.
    let envelope = match find_one_match(&rule.lhs, &host, rng.as_mut()) {
        None => ApplyEnvelope {
            applied: false,
            graph: host.to_graph(),
            created_nodes: vec![],
            created_edges: vec![],
            deleted_nodes: vec![],
            deleted_edges: vec![],
        },
        Some(m) => {
            let mut counter: i64 = 0;
            let mut id_seq: i64 = 0;
            let out = apply_rule_at(&mut host, &rule, &m, rng.as_mut(), &mut counter, &mut id_seq)?;
            ApplyEnvelope {
                applied: true,
                graph: host.to_graph(),
                created_nodes: out.created_nodes,
                created_edges: out.created_edges,
                deleted_nodes: out.deleted_nodes,
                deleted_edges: out.deleted_edges,
            }
        }
    };
    Ok(serde_json::to_string(&envelope).expect("envelope serializes"))
}

/// Apply `rule_json` to `graph_json` once, deterministically (no RNG). Random
/// PropExprs (`randInt`/`randFloat`) are rejected; use [`apply_rule_seeded`].
pub fn apply_rule(rule_json: &str, graph_json: &str) -> Result<String, ApiError> {
    apply_inner(rule_json, graph_json, None)
}

/// Apply `rule_json` to `graph_json` once with a seeded RNG: stochastic match
/// selection and random PropExprs are reproduced bit-for-bit against the TS
/// engine's `findOneMatch(rng) + applyRule({ rng })` for the same seed.
pub fn apply_rule_seeded(rule_json: &str, graph_json: &str, seed: u32) -> Result<String, ApiError> {
    apply_inner(rule_json, graph_json, Some(Rng::new(seed)))
}
