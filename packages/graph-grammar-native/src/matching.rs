use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde_json::Value;

use crate::graph::Host;
use crate::rng::Rng;
use crate::types::{GEdge, GNode, MatchResult, PatternEdge, PatternGraph, PatternNode, PropPredicate, Props};

// ============================================================================
// Matching ,a deterministic backtracking subgraph search (no RNG) that mirrors
// match.ts faithfully enough to return the SAME first match the TS engine's
// `findMatches(..., { limit: 1 })` (no-RNG) path returns:
//   * VF2++ variable ordering (compilePattern): rarest-label seed, then
//     connectivity-guided, ties broken by pattern-node order,
//   * candidate iteration order (candidateStream): label-bucket insertion order
//     for a seed, distinct neighbours in incident-edge insertion order otherwise,
//   * back-edge satisfaction with edge-injectivity within a node (backEdgesOk).
// Random candidate shuffling (the stochastic path) is Phase 3.
// ============================================================================

fn is_wild_label(label: &str, wildcard: bool) -> bool {
    wildcard || label == "*" || label.is_empty()
}

fn values_eq(a: &Value, b: &Value) -> bool {
    a == b // serde_json compares numbers by value; mirrors JS === for our PropValues
}

fn eval_predicate(props: &Props, p: &PropPredicate) -> bool {
    let v = props.get(&p.key);
    let rhs = p.value.clone().unwrap_or(Value::Null);
    let num = |x: Option<&Value>| x.and_then(|v| v.as_f64());
    match p.op.as_str() {
        "exists" => matches!(v, Some(x) if !x.is_null()),
        "absent" => v.map_or(true, |x| x.is_null()),
        "eq" => v.map_or(false, |x| values_eq(x, &rhs)),
        "neq" => !v.map_or(false, |x| values_eq(x, &rhs)),
        "gt" => matches!((num(v), rhs.as_f64()), (Some(a), Some(b)) if a > b),
        "gte" => matches!((num(v), rhs.as_f64()), (Some(a), Some(b)) if a >= b),
        "lt" => matches!((num(v), rhs.as_f64()), (Some(a), Some(b)) if a < b),
        "lte" => matches!((num(v), rhs.as_f64()), (Some(a), Some(b)) if a <= b),
        "contains" => match (v.and_then(|x| x.as_str()), rhs.as_str()) {
            (Some(a), Some(b)) => a.contains(b),
            _ => false,
        },
        // `new RegExp(String(value)).test(v)` with try/catch → false. Rust's regex
        // crate matches JS for the common linear subset (no lookaround/backrefs,
        // which JS allows but are rarely used in grammar predicates); both do an
        // unanchored search and `.` excludes newline by default.
        "regex" => {
            let pat = match &rhs {
                Value::String(s) => s.clone(),
                Value::Null => return false,
                other => other.to_string(),
            };
            match v.and_then(|x| x.as_str()) {
                Some(s) => regex::Regex::new(&pat).is_ok_and(|re| re.is_match(s)),
                None => false,
            }
        }
        "in" => match (&rhs, v) {
            (Value::Array(arr), Some(x)) => arr.iter().any(|item| values_eq(item, x)),
            _ => false,
        },
        _ => false,
    }
}

fn node_matches(pn: &PatternNode, hn: &GNode) -> bool {
    if !is_wild_label(&pn.label, pn.wildcard) && pn.label != hn.label {
        return false;
    }
    pn.predicates.iter().all(|p| eval_predicate(&hn.props, p))
}

fn edge_label_matches(pe: &PatternEdge, he: &GEdge) -> bool {
    pe.wildcard || pe.label == "*" || pe.label.is_empty() || pe.label == he.label
}

/// Does host edge `he` satisfy pattern edge `pe`, given the bound endpoints
/// (`h_source` for pe.source, `h_target` for pe.target)? Mirrors match.ts.
fn edge_satisfies(pe: &PatternEdge, he: &GEdge, h_source: &str, h_target: &str) -> bool {
    if !edge_label_matches(pe, he) {
        return false;
    }
    if !pe.predicates.iter().all(|p| eval_predicate(&he.props, p)) {
        return false;
    }
    let orientation_constrained = pe.directed && !pe.any_direction;
    if orientation_constrained {
        he.directed && he.source == h_source && he.target == h_target
    } else {
        (he.source == h_source && he.target == h_target)
            || (he.source == h_target && he.target == h_source)
    }
}

/// Host-side match indices, built fresh from current host state (matching always
/// runs before any rewrite mutation, so a snapshot is correct and simplest).
struct MatchIndex {
    /// label -> node ids, in graph insertion order (mirrors byLabel/LabelBucket).
    by_label: HashMap<String, Vec<String>>,
    /// node id -> incident edge ids, in insertion order (mirrors the `incident`
    /// Set; a self-loop appears once).
    incident: HashMap<String, Vec<String>>,
}

fn build_match_index(host: &Host) -> MatchIndex {
    // by_label is maintained incrementally (LabelBucket swap-remove order); only
    // incident is rebuilt (Set semantics = insertion order, which edge_order
    // already preserves through deletions).
    let by_label = host.by_label.clone();
    let mut incident: HashMap<String, Vec<String>> = HashMap::new();
    for id in &host.node_order {
        incident.entry(id.clone()).or_default();
    }
    for eid in &host.edge_order {
        let e = &host.edges[eid];
        incident.entry(e.source.clone()).or_default().push(eid.clone());
        if e.target != e.source {
            incident.entry(e.target.clone()).or_default().push(eid.clone());
        }
    }
    MatchIndex { by_label, incident }
}

struct BackEdge {
    pe_index: usize,  // index into lhs.edges
    other_pos: usize, // order position of the already-bound endpoint
    this_is_source: bool,
}

/// A compiled pattern: the VF2++ binding order plus, per position, the edges
/// back to already-bound nodes that must be satisfied.
struct Compiled {
    order: Vec<usize>,              // pattern node indices, in binding order
    back_edges: Vec<Vec<BackEdge>>, // indexed by order position
}

fn compile_pattern(lhs: &PatternGraph, mi: &MatchIndex) -> Compiled {
    let n = lhs.nodes.len();
    let id_to_idx: HashMap<&str, usize> =
        lhs.nodes.iter().enumerate().map(|(i, pn)| (pn.id.as_str(), i)).collect();

    // node index -> incident pattern-edge indices, in edge order (a self-loop is
    // pushed twice, mirroring the TS adjacency build → it counts toward degree).
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (ei, pe) in lhs.edges.iter().enumerate() {
        if let Some(&si) = id_to_idx.get(pe.source.as_str()) {
            adj[si].push(ei);
        }
        if let Some(&ti) = id_to_idx.get(pe.target.as_str()) {
            adj[ti].push(ei);
        }
    }

    let other_idx = |ni: usize, ei: usize| -> Option<usize> {
        let pe = &lhs.edges[ei];
        let other = if pe.source == lhs.nodes[ni].id { &pe.target } else { &pe.source };
        id_to_idx.get(other.as_str()).copied()
    };

    // Seed selection: maximize (connected?, -candidate-count, degree), ties to the
    // earliest pattern-node index. Mirrors compilePattern's key ordering.
    let mut removed = vec![false; n];
    let mut order: Vec<usize> = Vec::with_capacity(n);
    for _ in 0..n {
        let mut best: Option<usize> = None;
        let mut best_key: Option<(i32, i64, i64)> = None;
        for ni in 0..n {
            if removed[ni] {
                continue;
            }
            let connected = adj[ni].iter().any(|&ei| other_idx(ni, ei).map_or(false, |oi| removed[oi]));
            let pn = &lhs.nodes[ni];
            let cand: i64 = if is_wild_label(&pn.label, pn.wildcard) {
                i64::MAX
            } else {
                mi.by_label.get(&pn.label).map_or(0, |v| v.len()) as i64
            };
            let key = (connected as i32, -cand, adj[ni].len() as i64);
            if best_key.map_or(true, |bk| key > bk) {
                best_key = Some(key);
                best = Some(ni);
            }
        }
        let b = best.expect("non-empty remaining set");
        order.push(b);
        removed[b] = true;
    }

    let mut pos_of = vec![0usize; n];
    for (i, &ni) in order.iter().enumerate() {
        pos_of[ni] = i;
    }

    let mut back_edges: Vec<Vec<BackEdge>> = (0..n).map(|_| Vec::new()).collect();
    for (i, &ni) in order.iter().enumerate() {
        for &ei in &adj[ni] {
            let Some(oi) = other_idx(ni, ei) else { continue };
            if pos_of[oi] < i {
                back_edges[i].push(BackEdge {
                    pe_index: ei,
                    other_pos: pos_of[oi],
                    this_is_source: lhs.edges[ei].source == lhs.nodes[ni].id,
                });
            }
        }
    }

    Compiled { order, back_edges }
}

struct Matcher<'a> {
    lhs: &'a PatternGraph,
    host: &'a Host,
    mi: &'a MatchIndex,
    compiled: &'a Compiled,
    bound: Vec<Option<String>>,
    used: HashSet<String>,
    edge_binding: Vec<Option<String>>, // indexed by pattern-edge index
    /// When set, candidate order is randomised (stochastic path), mirroring the
    /// RNG use in findMatches: `iterRandom` for a seed, `shuffle` for neighbours.
    rng: Option<&'a mut Rng>,
    results: Vec<MatchResult>,
    limit: usize, // 0 = enumerate all
}

impl Matcher<'_> {
    fn candidate_stream(&mut self, pi: usize) -> Vec<String> {
        let back = &self.compiled.back_edges[pi];
        if let Some(first) = back.first() {
            // Neighbours of the first already-bound anchor, distinct, in
            // incident-edge insertion order (then shuffled if stochastic).
            let anchor = self.bound[first.other_pos].clone().expect("anchor bound");
            let mut seen: HashSet<String> = HashSet::new();
            let mut out: Vec<String> = Vec::new();
            if let Some(inc) = self.mi.incident.get(&anchor) {
                for eid in inc {
                    let e = &self.host.edges[eid];
                    let other = if e.source == anchor { e.target.clone() } else { e.source.clone() };
                    if other == anchor || seen.contains(&other) {
                        continue;
                    }
                    seen.insert(other.clone());
                    out.push(other);
                }
            }
            if let Some(rng) = self.rng.as_deref_mut() {
                rng.shuffle(&mut out);
            }
            out
        } else {
            let pn = &self.lhs.nodes[self.compiled.order[pi]];
            if !is_wild_label(&pn.label, pn.wildcard) {
                let bucket = self.mi.by_label.get(&pn.label).cloned().unwrap_or_default();
                match self.rng.as_deref_mut() {
                    Some(rng) => rng.iter_random(&bucket),
                    None => bucket,
                }
            } else {
                // Wildcard seed: the engine iterates host.nodes.keys() ,NOT shuffled.
                self.host.node_order.clone()
            }
        }
    }

    /// Verify the back-edges at order position `pi` when bound to `hid`; returns
    /// the (pattern-edge index, host-edge id) bindings or None on failure.
    fn back_edges_ok(&self, pi: usize, hid: &str) -> Option<Vec<(usize, String)>> {
        let mut sat: Vec<(usize, String)> = Vec::new();
        for be in &self.compiled.back_edges[pi] {
            let other_host = self.bound[be.other_pos].as_deref().expect("bound");
            let (h_source, h_target) =
                if be.this_is_source { (hid, other_host) } else { (other_host, hid) };
            let pe = &self.lhs.edges[be.pe_index];
            let mut found: Option<String> = None;
            for he in self.host.edges_between(hid, other_host) {
                if sat.iter().any(|(_, id)| id == &he.id) {
                    continue; // edge-injectivity within this node's back-edges
                }
                if edge_satisfies(pe, &he, h_source, h_target) {
                    found = Some(he.id.clone());
                    break;
                }
            }
            sat.push((be.pe_index, found?));
        }
        Some(sat)
    }

    fn build_match(&self) -> MatchResult {
        let node_map = self
            .compiled
            .order
            .iter()
            .enumerate()
            .map(|(i, &ni)| (self.lhs.nodes[ni].id.clone(), self.bound[i].clone().unwrap()))
            .collect();
        let mut edge_map = IndexMap::new();
        for (ei, binding) in self.edge_binding.iter().enumerate() {
            if let Some(hid) = binding {
                edge_map.insert(self.lhs.edges[ei].id.clone(), hid.clone());
            }
        }
        MatchResult { node_map, edge_map }
    }

    /// Returns true to stop the search (limit reached) ,mirrors findMatches'
    /// recurse contract so RNG consumption along the search path matches.
    fn recurse(&mut self, pi: usize) -> bool {
        if self.limit != 0 && self.results.len() >= self.limit {
            return true;
        }
        if pi == self.compiled.order.len() {
            let m = self.build_match();
            self.results.push(m);
            return false;
        }
        let cands = self.candidate_stream(pi);
        let pi_node = self.compiled.order[pi];
        for hid in cands {
            if self.used.contains(&hid) {
                continue;
            }
            let pn = &self.lhs.nodes[pi_node];
            if !node_matches(pn, &self.host.nodes[&hid]) {
                continue;
            }
            if let Some(d) = pn.exact_degree {
                let deg = self.mi.incident.get(&hid).map_or(0, |v| v.len());
                if deg as f64 != d {
                    continue;
                }
            }
            let Some(sat) = self.back_edges_ok(pi, &hid) else { continue };
            self.bound[pi] = Some(hid.clone());
            self.used.insert(hid.clone());
            for (pe_index, he_id) in &sat {
                self.edge_binding[*pe_index] = Some(he_id.clone());
            }
            let done = self.recurse(pi + 1);
            self.used.remove(&hid);
            self.bound[pi] = None;
            for (pe_index, _) in &sat {
                self.edge_binding[*pe_index] = None;
            }
            if done {
                return true;
            }
        }
        false
    }
}

/// Find up to `limit` matches (0 = all) of `lhs` in `host`, in the engine's DFS
/// order. With `rng`, the stochastic candidate order is used.
pub(crate) fn find_matches(
    lhs: &PatternGraph,
    host: &Host,
    limit: usize,
    rng: Option<&mut Rng>,
) -> Vec<MatchResult> {
    if lhs.nodes.is_empty() {
        return Vec::new();
    }
    let mi = build_match_index(host);
    // Cheap impossibility check: a concrete-label node with no host bucket ⇒ none.
    for pn in &lhs.nodes {
        if !is_wild_label(&pn.label, pn.wildcard)
            && mi.by_label.get(&pn.label).map_or(0, |v| v.len()) == 0
        {
            return Vec::new();
        }
    }
    let compiled = compile_pattern(lhs, &mi);
    let mut m = Matcher {
        lhs,
        host,
        mi: &mi,
        compiled: &compiled,
        bound: vec![None; lhs.nodes.len()],
        used: HashSet::new(),
        edge_binding: vec![None; lhs.edges.len()],
        rng,
        results: Vec::new(),
        limit,
    };
    m.recurse(0);
    m.results
}

pub(crate) fn find_one_match(lhs: &PatternGraph, host: &Host, rng: Option<&mut Rng>) -> Option<MatchResult> {
    find_matches(lhs, host, 1, rng).into_iter().next()
}
