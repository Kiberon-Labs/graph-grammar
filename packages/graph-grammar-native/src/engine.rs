use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::graph::Host;
use crate::matching::{find_matches, find_one_match};
use crate::rewrite::apply_rule_at;
use crate::rng::Rng;
use crate::schema::{parse_validated, schema_check};
use crate::types::{ApiError, Grammar, Graph, MatchResult, Rule};

// ============================================================================
// Stateful engine ,a port of engine.ts. Drives a rule set over the host graph
// under a strategy (random/priority/sequential/maximal), with reproducible RNG
// seeded from config.seed. Holds the graph, RNG, per-rule application counts and
// the sequential pointer. One step costs one match search.
// ============================================================================

#[derive(Serialize, Default)]
pub(crate) struct StepResult {
    applied: bool,
    #[serde(rename = "ruleId", skip_serializing_if = "Option::is_none")]
    rule_id: Option<String>,
    #[serde(rename = "createdNodes")]
    created_nodes: Vec<String>,
    #[serde(rename = "createdEdges")]
    created_edges: Vec<String>,
    #[serde(rename = "deletedNodes")]
    deleted_nodes: Vec<String>,
    #[serde(rename = "deletedEdges")]
    deleted_edges: Vec<String>,
}

/// Opaque stateful engine handle (exposed across the FFI as `Engine*`).
pub struct Engine {
    grammar: Grammar,
    pub(crate) host: Host,
    rng: Rng,
    counter: i64,
    id_seq: i64,
    steps: i64,
    app_count: HashMap<String, i64>,
    seq_ptr: usize,
}

impl Engine {
    fn new(grammar: Grammar, start: Option<Graph>) -> Self {
        let start_graph = start.unwrap_or_else(|| grammar.start.clone());
        let rng = Rng::new(grammar.config.seed as u32);
        Engine {
            host: Host::from_graph(start_graph),
            grammar,
            rng,
            counter: 0,
            id_seq: 0,
            steps: 0,
            app_count: HashMap::new(),
            seq_ptr: 0,
        }
    }

    fn node_delta(&self, rule: &Rule) -> i64 {
        let preserved: HashSet<&str> =
            rule.rhs.nodes.iter().filter_map(|n| n.map_from.as_deref()).collect();
        let created = rule.rhs.nodes.iter().filter(|n| n.map_from.is_none()).count() as i64;
        let deleted =
            rule.lhs.nodes.iter().filter(|n| !preserved.contains(n.id.as_str())).count() as i64;
        created - deleted
    }

    fn fits_node_budget(&self, rule: &Rule) -> bool {
        let cap = self.grammar.config.max_nodes;
        cap <= 0 || self.host.nodes.len() as i64 + self.node_delta(rule) <= cap
    }

    fn enabled_rules(&self) -> Vec<usize> {
        (0..self.grammar.rules.len())
            .filter(|&i| {
                let r = &self.grammar.rules[i];
                r.enabled
                    && !r.lhs.nodes.is_empty()
                    && (r.max_applications == 0
                        || self.app_count.get(&r.id).copied().unwrap_or(0) < r.max_applications)
                    && self.fits_node_budget(r)
            })
            .collect()
    }

    fn nac_blocked(&self, ri: usize) -> bool {
        self.grammar.rules[ri]
            .nac
            .iter()
            .any(|nac| !nac.nodes.is_empty() && find_one_match(nac, &self.host, None).is_some())
    }

    /// A single random match for a rule (NAC-aware), or None. Consumes RNG.
    fn one_match(&mut self, ri: usize) -> Option<MatchResult> {
        if self.nac_blocked(ri) {
            return None;
        }
        let lhs = &self.grammar.rules[ri].lhs;
        find_one_match(lhs, &self.host, Some(&mut self.rng))
    }

    fn pick_rule_and_match(&mut self) -> Option<(usize, MatchResult)> {
        let rules = self.enabled_rules();
        if rules.is_empty() {
            return None;
        }
        match self.grammar.config.strategy.as_str() {
            "priority" => {
                let mut sorted = rules;
                // stable sort by priority desc (mirrors [...].sort((a,b)=>b.priority-a.priority))
                sorted.sort_by(|&a, &b| {
                    self.grammar.rules[b]
                        .priority
                        .partial_cmp(&self.grammar.rules[a].priority)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                for ri in sorted {
                    if let Some(m) = self.one_match(ri) {
                        return Some((ri, m));
                    }
                }
                None
            }
            "sequential" => {
                let n = rules.len();
                for i in 0..n {
                    let ri = rules[(self.seq_ptr + i) % n];
                    if let Some(m) = self.one_match(ri) {
                        self.seq_ptr = (self.seq_ptr + i + 1) % n;
                        return Some((ri, m));
                    }
                }
                None
            }
            // random (default): weight-biased draw among applicable rules; first
            // that matches wins, without probing every rule up front.
            _ => {
                let mut pool = rules;
                let mut weights: Vec<f64> =
                    pool.iter().map(|&ri| self.grammar.rules[ri].weight).collect();
                while !pool.is_empty() {
                    let idx = self.rng.weighted_index(&weights);
                    let ri = pool[idx];
                    if let Some(m) = self.one_match(ri) {
                        return Some((ri, m));
                    }
                    pool.remove(idx);
                    weights.remove(idx);
                }
                None
            }
        }
    }

    fn pick_maximal_rule(&mut self) -> Option<usize> {
        // Filter is deterministic (no RNG); only the weighted pick draws.
        let candidates: Vec<usize> = self
            .enabled_rules()
            .into_iter()
            .filter(|&ri| {
                !self.nac_blocked(ri)
                    && !find_matches(&self.grammar.rules[ri].lhs, &self.host, 1, None).is_empty()
            })
            .collect();
        if candidates.is_empty() {
            return None;
        }
        let weights: Vec<f64> = candidates.iter().map(|&ri| self.grammar.rules[ri].weight).collect();
        let idx = self.rng.weighted_index(&weights);
        Some(candidates[idx])
    }

    fn apply_maximal(&mut self, ri: usize) -> Result<StepResult, ApiError> {
        // All matches, deterministic order, then shuffled (mirrors applyMaximal).
        let mut matches = find_matches(&self.grammar.rules[ri].lhs, &self.host, 0, None);
        if matches.is_empty() {
            return Ok(StepResult::default());
        }
        self.rng.shuffle(&mut matches);

        let mut used: HashSet<String> = HashSet::new();
        let mut agg = StepResult::default();
        let mut count = 0i64;
        for m in &matches {
            let nodes: Vec<String> = m.node_map.values().cloned().collect();
            if nodes.iter().any(|n| used.contains(n)) {
                continue;
            }
            let prob = self.grammar.rules[ri].probability;
            if prob < 1.0 && self.rng.next() > prob {
                continue;
            }
            let max_app = self.grammar.rules[ri].max_applications;
            let id = self.grammar.rules[ri].id.clone();
            if max_app != 0 && self.app_count.get(&id).copied().unwrap_or(0) >= max_app {
                break;
            }
            if !self.fits_node_budget(&self.grammar.rules[ri]) {
                break;
            }
            let out = apply_rule_at(
                &mut self.host,
                &self.grammar.rules[ri],
                m,
                Some(&mut self.rng),
                &mut self.counter,
                &mut self.id_seq,
            )?;
            for n in nodes {
                used.insert(n);
            }
            agg.created_nodes.extend(out.created_nodes);
            agg.created_edges.extend(out.created_edges);
            agg.deleted_nodes.extend(out.deleted_nodes);
            agg.deleted_edges.extend(out.deleted_edges);
            *self.app_count.entry(id).or_insert(0) += 1;
            count += 1;
        }
        if count > 0 {
            self.steps += 1;
        }
        agg.applied = count > 0;
        agg.rule_id = Some(self.grammar.rules[ri].id.clone());
        Ok(agg)
    }

    pub(crate) fn step(&mut self) -> Result<StepResult, ApiError> {
        if self.grammar.config.strategy == "maximal" {
            return match self.pick_maximal_rule() {
                Some(ri) => self.apply_maximal(ri),
                None => Ok(StepResult::default()),
            };
        }

        let Some((ri, m)) = self.pick_rule_and_match() else {
            return Ok(StepResult::default());
        };

        // Probability gate: a no-op step that still returns a ruleId so the run
        // loop retries.
        let prob = self.grammar.rules[ri].probability;
        if prob < 1.0 && self.rng.next() > prob {
            return Ok(StepResult { rule_id: Some(self.grammar.rules[ri].id.clone()), ..Default::default() });
        }

        let out = apply_rule_at(
            &mut self.host,
            &self.grammar.rules[ri],
            &m,
            Some(&mut self.rng),
            &mut self.counter,
            &mut self.id_seq,
        )?;
        let id = self.grammar.rules[ri].id.clone();
        *self.app_count.entry(id.clone()).or_insert(0) += 1;
        self.steps += 1;
        Ok(StepResult {
            applied: true,
            rule_id: Some(id),
            created_nodes: out.created_nodes,
            created_edges: out.created_edges,
            deleted_nodes: out.deleted_nodes,
            deleted_edges: out.deleted_edges,
        })
    }

    /// Run until no rule applies or a bound is hit. `max_steps`: None → use
    /// config.maxSteps; <=0 → an uncapped run with a hard safety bound.
    pub(crate) fn run(&mut self, max_steps: Option<i64>) -> Result<i64, ApiError> {
        let requested = max_steps.unwrap_or(self.grammar.config.max_steps);
        let cap: i64 = if requested > 0 { requested } else { 500_000 };
        let mut applied = 0i64;
        let mut empty_streak = 0;
        for _ in 0..cap {
            let r = self.step()?;
            if !r.applied {
                // probability skips return a ruleId; allow bounded retries.
                if r.rule_id.is_some() && empty_streak < 64 {
                    empty_streak += 1;
                    continue;
                }
                break;
            }
            empty_streak = 0;
            applied += 1;
        }
        Ok(applied)
    }
}

pub(crate) fn engine_from_json(grammar_json: &str, start_json: Option<&str>) -> Result<Engine, ApiError> {
    let grammar: Grammar = parse_validated(grammar_json, schema_check::grammar(), "grammar")?;
    let start = match start_json {
        Some(s) => Some(parse_validated::<Graph>(s, schema_check::graph(), "start graph")?),
        None => None,
    };
    Ok(Engine::new(grammar, start))
}

/// Build an engine from a grammar, run it, and return `(final_graph_json, applied)`.
/// Convenience for tests / one-shot use; the FFI uses the stateful handle.
pub fn run_grammar(
    grammar_json: &str,
    start_json: Option<&str>,
    max_steps: Option<i64>,
) -> Result<(String, i64), ApiError> {
    let mut engine = engine_from_json(grammar_json, start_json)?;
    let applied = engine.run(max_steps)?;
    let graph = serde_json::to_string(&engine.host.to_graph()).expect("graph serializes");
    Ok((graph, applied))
}
