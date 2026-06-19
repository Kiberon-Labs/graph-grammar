use std::collections::HashMap;

use crate::types::{GEdge, GNode, Graph};

// ============================================================================
// Host graph ,an insertion-ordered node/edge store mirroring the TS GraphIndex
// (a JS Map preserves insertion order; toGraph() iterates it). Small-graph
// scans are fine for a slice; the indexed fast paths are a later optimisation.
// ============================================================================

pub(crate) struct Host {
    pub(crate) node_order: Vec<String>,
    pub(crate) nodes: HashMap<String, GNode>,
    pub(crate) edge_order: Vec<String>,
    pub(crate) edges: HashMap<String, GEdge>,
    /// label -> node ids, maintained with LabelBucket semantics: append on add,
    /// **swap-remove** on delete/relabel. The swap-remove (not stable removal) is
    /// what the stochastic `iterRandom` walk observes, so it must be replicated
    /// to match the engine across multiple steps.
    pub(crate) by_label: HashMap<String, Vec<String>>,
}

impl Host {
    pub(crate) fn from_graph(g: Graph) -> Self {
        let mut h = Host {
            node_order: Vec::new(),
            nodes: HashMap::new(),
            edge_order: Vec::new(),
            edges: HashMap::new(),
            by_label: HashMap::new(),
        };
        for n in g.nodes {
            h.add_node(n);
        }
        for e in g.edges {
            h.add_edge(e);
        }
        h
    }

    pub(crate) fn add_node(&mut self, n: GNode) {
        if !self.nodes.contains_key(&n.id) {
            self.node_order.push(n.id.clone());
            self.by_label.entry(n.label.clone()).or_default().push(n.id.clone());
        }
        self.nodes.insert(n.id.clone(), n);
    }

    /// Change a node's label, keeping LabelBucket order (swap-remove old + append
    /// new). Mirrors GraphIndex.relabelNode.
    pub(crate) fn relabel_node(&mut self, id: &str, new_label: &str) {
        let old = match self.nodes.get(id) {
            Some(n) if n.label != new_label => n.label.clone(),
            _ => return,
        };
        if let Some(bucket) = self.by_label.get_mut(&old) {
            if let Some(pos) = bucket.iter().position(|x| x == id) {
                bucket.swap_remove(pos);
            }
        }
        self.by_label.entry(new_label.to_string()).or_default().push(id.to_string());
        self.nodes.get_mut(id).unwrap().label = new_label.to_string();
    }

    pub(crate) fn add_edge(&mut self, e: GEdge) {
        if !self.edges.contains_key(&e.id) {
            self.edge_order.push(e.id.clone());
        }
        self.edges.insert(e.id.clone(), e);
    }

    pub(crate) fn remove_edge(&mut self, id: &str) {
        self.edges.remove(id);
        self.edge_order.retain(|x| x != id);
    }

    pub(crate) fn remove_node(&mut self, id: &str) {
        for e in self.incident_edges(id) {
            self.remove_edge(&e.id);
        }
        if let Some(n) = self.nodes.get(id) {
            let label = n.label.clone();
            if let Some(bucket) = self.by_label.get_mut(&label) {
                if let Some(pos) = bucket.iter().position(|x| x == id) {
                    bucket.swap_remove(pos);
                }
            }
        }
        self.nodes.remove(id);
        self.node_order.retain(|x| x != id);
    }

    pub(crate) fn incident_edges(&self, nid: &str) -> Vec<GEdge> {
        self.edge_order
            .iter()
            .filter_map(|eid| {
                let e = &self.edges[eid];
                if e.source == nid || e.target == nid {
                    Some(e.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    pub(crate) fn edges_between(&self, a: &str, b: &str) -> Vec<GEdge> {
        self.edge_order
            .iter()
            .filter_map(|eid| {
                let e = &self.edges[eid];
                if (e.source == a && e.target == b) || (e.source == b && e.target == a) {
                    Some(e.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    pub(crate) fn to_graph(&self) -> Graph {
        Graph {
            nodes: self.node_order.iter().map(|id| self.nodes[id].clone()).collect(),
            edges: self.edge_order.iter().map(|id| self.edges[id].clone()).collect(),
        }
    }
}
