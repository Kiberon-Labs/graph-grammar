//! graph-grammar-native ,a C-ABI `cdylib` exposing the graph-grammar rewrite
//! engine to non-TypeScript callers. JSON in / JSON out, validated against the
//! engine's zod-derived schema, with behaviour (including the seeded RNG)
//! reproduced bit-for-bit and verified by the conformance suite.
//!
//! Module map:
//!   types    ,serde data model (graph, rule, grammar) + ApiError
//!   rng      ,Mulberry32 RNG, ported call-for-call from util.ts
//!   schema   ,JSON-Schema validation at the boundary (the single contract)
//!   graph    ,the mutable Host store (mirrors GraphIndex)
//!   matching ,VF2++ subgraph matcher (match.ts)
//!   rewrite  ,single-rule application (rewrite.ts)
//!   engine   ,the stateful step/run loop (engine.ts)
//!   api      ,one-shot apply entry points (deterministic + seeded)
//!   ffi      ,the `gg_*` C ABI

mod api;
mod engine;
mod ffi;
mod graph;
mod matching;
mod rewrite;
mod rng;
mod schema;
mod types;

// Public Rust API (the C ABI lives in `ffi` and is exported by symbol). The
// integration tests consume these.
pub use api::{apply_rule, apply_rule_seeded};
pub use engine::{run_grammar, Engine};
pub use types::ApiError;
