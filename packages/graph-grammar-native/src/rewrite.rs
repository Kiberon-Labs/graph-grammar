use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde_json::Value;

use crate::graph::Host;
use crate::rng::{number_value, Rng};
use crate::types::{ApiError, EmbeddingRule, GEdge, GNode, MatchResult, PropExpr, Props, Rule};

// ============================================================================
// Property expressions (rewrite.ts evalExpr) ,deterministic kinds only.
// ============================================================================

/// The no-seed (deterministic) entry point has no RNG, so a random PropExpr is a
/// usage error there (code 3); the seeded entry point always supplies one.
fn need_rng(rng: Option<&mut Rng>) -> Result<&mut Rng, ApiError> {
    rng.ok_or(ApiError {
        code: 3,
        detail: "random PropExpr (randInt/randFloat) requires a seed; use gg_apply_rule_seeded"
            .to_string(),
    })
}

fn eval_expr(
    expr: &PropExpr,
    host: &Host,
    node_map: &IndexMap<String, String>,
    rng: Option<&mut Rng>,
    counter: &mut i64,
) -> Result<Value, ApiError> {
    let lookup = |from: &str, key: &str| -> Option<Value> {
        let hid = node_map.get(from)?;
        let n = host.nodes.get(hid)?;
        Some(n.props.get(key).cloned().unwrap_or(Value::Null))
    };
    Ok(match expr {
        PropExpr::Literal { value } => value.clone(),
        PropExpr::Copy { from, key } => lookup(from, key).unwrap_or(Value::Null),
        PropExpr::Increment { from, key, by } => {
            let base = lookup(from, key).and_then(|v| v.as_f64()).unwrap_or(0.0);
            number_value(base + by)
        }
        PropExpr::Counter => {
            *counter += 1;
            Value::from(*counter)
        }
        PropExpr::RandInt { min, max } => number_value(need_rng(rng)?.int(*min, *max)),
        PropExpr::RandFloat { min, max } => number_value(need_rng(rng)?.float(*min, *max)),
    })
}

fn apply_set_props(
    base: &Props,
    set_props: &Option<IndexMap<String, PropExpr>>,
    host: &Host,
    node_map: &IndexMap<String, String>,
    mut rng: Option<&mut Rng>,
    counter: &mut i64,
) -> Result<Props, ApiError> {
    let mut out = base.clone();
    if let Some(sp) = set_props {
        // Insertion order (mirrors the engine's Object.entries), so the RNG is
        // consumed in the same order for multiple random expressions.
        for (k, expr) in sp {
            out.insert(k.clone(), eval_expr(expr, host, node_map, rng.as_deref_mut(), counter)?);
        }
    }
    Ok(out)
}

// ============================================================================
// Rewrite ,a faithful port of rewrite.ts applyRule, minus the RNG layout
// jitter for created nodes (positions are renderer metadata). Created element
// ids are deterministic (`n_native_*` / `e_native_*`); the TS engine uses
// volatile uid()s, so conformance compares created elements up to id-renaming.
// ============================================================================

pub(crate) struct ApplyOut {
    pub(crate) created_nodes: Vec<String>,
    pub(crate) created_edges: Vec<String>,
    pub(crate) deleted_nodes: Vec<String>,
    pub(crate) deleted_edges: Vec<String>,
}

pub(crate) fn apply_rule_at(
    host: &mut Host,
    rule: &Rule,
    m: &MatchResult,
    mut rng: Option<&mut Rng>,
    counter: &mut i64,
    id_seq: &mut i64,
) -> Result<ApplyOut, ApiError> {
    // id_seq is owned by the caller so created-element ids stay unique ACROSS
    // applies (the engine's uid() is globally monotonic); a per-call counter
    // would collide on every engine step and corrupt the graph.
    let mut next_id = |prefix: &str| {
        *id_seq += 1;
        format!("{prefix}_native_{}", *id_seq)
    };

    let mut created_nodes: Vec<String> = Vec::new();
    let mut created_edges: Vec<String> = Vec::new();
    let mut deleted_nodes: Vec<String> = Vec::new();
    let mut deleted_edges: Vec<String> = Vec::new();

    // 1. Which LHS nodes are preserved (referenced by a RHS node via mapFrom)?
    let preserved_lhs: HashSet<String> =
        rule.rhs.nodes.iter().filter_map(|rn| rn.map_from.clone()).collect();
    let matched_host_nodes: HashSet<String> = m.node_map.values().cloned().collect();
    let mut rhs_to_host: HashMap<String, String> = HashMap::new();

    // 2. Preserved nodes: relabel + property mutations.
    for rn in &rule.rhs.nodes {
        let Some(mf) = &rn.map_from else { continue };
        let Some(hid) = m.node_map.get(mf) else { continue };
        if !host.nodes.contains_key(hid) {
            continue;
        }
        if !rn.label.is_empty() && rn.label != "*" {
            host.relabel_node(hid, &rn.label);
        }
        let base = host.nodes[hid].props.clone();
        let new_props = apply_set_props(&base, &rn.set_props, host, &m.node_map, rng.as_deref_mut(), counter)?;
        host.nodes.get_mut(hid).unwrap().props = new_props;
        rhs_to_host.insert(rn.id.clone(), hid.clone());
    }

    // 3. Collect dangling edges of soon-to-be-deleted matched nodes.
    let lhs_by_host: HashMap<String, String> =
        m.node_map.iter().map(|(l, h)| (h.clone(), l.clone())).collect();
    let matched_host_edge_ids: HashSet<String> = m.edge_map.values().cloned().collect();

    struct Dangling {
        edge: GEdge,
        lhs_node_id: String,
        external: String,
        is_source: bool,
    }
    let mut danglings: Vec<Dangling> = Vec::new();
    for (lid, hid) in &m.node_map {
        if preserved_lhs.contains(lid) {
            continue;
        }
        for e in host.incident_edges(hid) {
            if matched_host_edge_ids.contains(&e.id) {
                continue;
            }
            let other = if &e.source == hid { e.target.clone() } else { e.source.clone() };
            let other_is_deleted_match = matched_host_nodes.contains(&other)
                && !preserved_lhs.contains(lhs_by_host.get(&other).map(|s| s.as_str()).unwrap_or(""));
            if other_is_deleted_match {
                continue;
            }
            let is_source = &e.source == hid;
            danglings.push(Dangling { edge: e, lhs_node_id: lid.clone(), external: other, is_source });
        }
    }

    // Centroid of matched nodes that carry layout (mirrors rewrite.ts 6a) ,seeds
    // created-node positions. Only consumed by jitter on the stochastic path.
    let (mut cx, mut cy, mut cn) = (0.0_f64, 0.0_f64, 0u32);
    for hid in &matched_host_nodes {
        if let Some(hn) = host.nodes.get(hid) {
            if let (Some(x), Some(y)) = (hn.x, hn.y) {
                cx += x;
                cy += y;
                cn += 1;
            }
        }
    }
    if cn > 0 {
        cx /= cn as f64;
        cy /= cn as f64;
    }

    // 4. Create new RHS nodes (those without a mapFrom).
    for rn in &rule.rhs.nodes {
        if let Some(mf) = &rn.map_from {
            if m.node_map.contains_key(mf) {
                continue;
            }
        }
        let props = apply_set_props(&rn.props, &rn.set_props, host, &m.node_map, rng.as_deref_mut(), counter)?;
        // Layout jitter: `(next() - 0.5) * 40`, x then y, drawing only when there
        // is no provided coordinate ,exactly as `cn ? c+jitter() : (rn.x ?? jitter())`.
        let (x, y) = match rng.as_deref_mut() {
            Some(r) => {
                let x = if cn > 0 {
                    cx + (r.next() - 0.5) * 40.0
                } else {
                    rn.x.unwrap_or_else(|| (r.next() - 0.5) * 40.0)
                };
                let y = if cn > 0 {
                    cy + (r.next() - 0.5) * 40.0
                } else {
                    rn.y.unwrap_or_else(|| (r.next() - 0.5) * 40.0)
                };
                (Some(x), Some(y))
            }
            None => (None, None),
        };
        let id = next_id("n");
        let label = if !rn.label.is_empty() && rn.label != "*" {
            rn.label.clone()
        } else {
            "node".to_string()
        };
        host.add_node(GNode { id: id.clone(), label, props, x, y });
        rhs_to_host.insert(rn.id.clone(), id.clone());
        created_nodes.push(id);
    }

    // 5. Delete matched host edges not preserved by the RHS.
    let preserved_host_edges: HashSet<String> = rule
        .rhs
        .edges
        .iter()
        .filter_map(|re| re.map_from.as_ref().and_then(|mf| m.edge_map.get(mf)).cloned())
        .collect();
    for he_id in m.edge_map.values() {
        if !preserved_host_edges.contains(he_id) && host.edges.contains_key(he_id) {
            host.remove_edge(he_id);
            deleted_edges.push(he_id.clone());
        }
    }

    // 6. Embedding for dangling edges.
    let emb_by_lhs: HashMap<&str, &EmbeddingRule> =
        rule.embedding.iter().map(|er| (er.lhs_node_id.as_str(), er)).collect();
    for d in &danglings {
        let er = emb_by_lhs.get(d.lhs_node_id.as_str()).copied();
        if let Some(e) = er {
            if let Some(f) = &e.edge_label_filter {
                if &d.edge.label != f {
                    continue;
                }
            }
        }
        let strategy = er.map(|e| e.strategy.as_str()).unwrap_or("remove");
        if strategy == "remove" {
            continue;
        }
        let new_label = er
            .and_then(|e| e.new_edge_label.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| d.edge.label.clone());
        let mut targets: Vec<String> = Vec::new();
        if strategy == "redirectTo" {
            if let Some(tr) = er.and_then(|e| e.target_rhs_node_id.as_ref()) {
                if let Some(h) = rhs_to_host.get(tr) {
                    targets.push(h.clone());
                }
            }
        } else if strategy == "redirectToAll" {
            targets.extend(created_nodes.iter().cloned());
        }
        for t in targets {
            let (src, tgt) = if d.is_source {
                (t.clone(), d.external.clone())
            } else {
                (d.external.clone(), t.clone())
            };
            let id = next_id("e");
            host.add_edge(GEdge {
                id: id.clone(),
                source: src,
                target: tgt,
                label: new_label.clone(),
                props: d.edge.props.clone(),
                directed: d.edge.directed,
            });
            created_edges.push(id);
        }
    }

    // 7. Delete the LHS-deleted host nodes (removes remaining incident edges).
    let lhs_deleted: Vec<String> = m
        .node_map
        .iter()
        .filter(|(lid, _)| !preserved_lhs.contains(*lid))
        .map(|(_, hid)| hid.clone())
        .collect();
    for hid in &lhs_deleted {
        if host.nodes.contains_key(hid) {
            for e in host.incident_edges(hid) {
                if host.edges.contains_key(&e.id) {
                    deleted_edges.push(e.id.clone());
                }
            }
            host.remove_node(hid);
            deleted_nodes.push(hid.clone());
        }
    }

    // 8. Create new RHS edges (and relabel/merge preserved ones).
    for re in &rule.rhs.edges {
        if let Some(mf) = &re.map_from {
            if let Some(hid) = m.edge_map.get(mf) {
                if preserved_host_edges.contains(hid) {
                    if !re.label.is_empty() && re.label != "*" {
                        if let Some(he) = host.edges.get_mut(hid) {
                            if re.label != he.label {
                                he.label = re.label.clone();
                            }
                        }
                    }
                    if re.set_props.is_some() {
                        let base = host.edges[hid].props.clone();
                        let np = apply_set_props(&base, &re.set_props, host, &m.node_map, rng.as_deref_mut(), counter)?;
                        host.edges.get_mut(hid).unwrap().props = np;
                    }
                    continue;
                }
            }
        }
        let (Some(s), Some(t)) = (rhs_to_host.get(&re.source), rhs_to_host.get(&re.target)) else {
            continue;
        };
        let (s, t) = (s.clone(), t.clone());
        let props = apply_set_props(&re.props, &re.set_props, host, &m.node_map, rng.as_deref_mut(), counter)?;
        let id = next_id("e");
        let label = if re.label == "*" { String::new() } else { re.label.clone() };
        host.add_edge(GEdge { id: id.clone(), source: s, target: t, label, props, directed: re.directed });
        created_edges.push(id);
    }

    Ok(ApplyOut { created_nodes, created_edges, deleted_nodes, deleted_edges })
}
