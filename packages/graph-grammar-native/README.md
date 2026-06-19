# graph-grammar

A Rust crate **and** native C-ABI shared library (`.dll` / `.so` / `.dylib`)
that runs the **graph-grammar** rewrite engine — call it from Rust directly, or
from C#, Python, C/C++, and any FFI-capable language with **no Node/JS runtime**.
It is a faithful port of the
[TypeScript `graph-grammar` engine](https://www.npmjs.com/package/graph-grammar),
verified bit-for-bit against it.

The wire format is **JSON in / JSON out**, mirroring the TS engine's own
`exportGraph` / `importGrammar` boundary, so the API surface stays minimal and
stable.

## Use as a Rust crate

Published on [crates.io](https://crates.io/crates/graph-grammar) — add it to a
Rust project to drive the engine directly, with no FFI and no C header:

```sh
cargo add graph-grammar
```

```rust
use graph_grammar::{apply_rule, ApiError};

fn main() -> Result<(), ApiError> {
    // Rule and graph are JSON, in the shape defined by
    // schema/graph-grammar.schema.json (the same the TS engine exports/imports).
    let rule = r#"{ "id": "r1", "name": "relabel", "lhs": …, "rhs": … }"#;
    let graph = r#"{ "nodes": [ … ], "edges": [ … ] }"#;

    // Returns a JSON envelope: { "applied", "graph", "createdNodes", … }.
    let result = apply_rule(rule, graph)?;
    println!("{result}");
    Ok(())
}
```

The crate also exposes `apply_rule_seeded` (seeded-stochastic match selection +
random `PropExpr`s, bit-for-bit vs the TS engine) and the stateful `Engine`
(`run_grammar` / multi-step runs). Behaviour is verified against the real
TypeScript engine by the [conformance suite](#conformance).

## C ABI

Generated header: [`include/graph_grammar.h`](include/graph_grammar.h) (via cbindgen).

| Function | Purpose |
| --- | --- |
| `const char* gg_version(void)` | Library version. Pointer owned by the lib ,do **not** free. |
| `int gg_apply_rule(const char* rule_json, const char* graph_json, char** out_json)` | Apply one rule to one graph, deterministically (no RNG). Writes a newly-allocated result to `*out_json`. |
| `int gg_apply_rule_seeded(const char* rule_json, const char* graph_json, uint32_t seed, char** out_json)` | Same, but with a seeded RNG: stochastic match selection + random PropExprs, bit-for-bit vs the TS engine. |
| `void gg_string_free(char* s)` | Release a string returned via an `out_json` out-parameter. |

### Stateful engine handle

For multi-step runs, `gg_engine_new` returns an opaque `Engine*` (seeded from
`config.seed`) that must be released exactly once with `gg_engine_free`. Not
thread-safe.

| Function | Purpose |
| --- | --- |
| `Engine* gg_engine_new(const char* grammar_json, const char* start_graph_json, char** err_out)` | Build an engine. `start_graph_json` may be NULL (use the grammar's `start`). Returns NULL + `*err_out` on error. |
| `int gg_engine_step(Engine*, char** out_json)` | Advance one step; writes `{ applied, ruleId?, createdNodes, … }`. |
| `int gg_engine_run(Engine*, int32_t max_steps, char** out_json)` | Run to a fixpoint/bound (`max_steps < 0` ⇒ use `config.maxSteps`); writes `{ "applied": <count> }`. |
| `int gg_engine_graph(Engine*, char** out_json)` | Snapshot the current host graph as `{ nodes, edges }`. |
| `void gg_engine_free(Engine*)` | Release the handle. |

All four strategies (`random` / `priority` / `sequential` / `maximal`),
probability gates, `maxNodes`/`maxApplications` budgets, and NACs are reproduced;
a seeded run matches the TS `Engine` bit-for-bit.

`gg_apply_rule` returns `0` on success; the result is an envelope:

```json
{ "applied": true, "graph": { "nodes": [...], "edges": [...] },
  "createdNodes": [], "createdEdges": [], "deletedNodes": [], "deletedEdges": [] }
```

On error it returns non-zero and `*out_json` is `{ "error": { "code", "detail" } }`:
`1` = bad input JSON, `3` = unsupported feature, `-1` = null argument / internal panic.

Every returned `out_json` must be released with `gg_string_free`.

## Source layout

`src/` is split by concern (each module's visibility is `pub(crate)`; only the
`api`/`engine` entry points and the `ffi` symbols are public):

| Module | Responsibility |
| --- | --- |
| `types` | serde data model (graph, rule, grammar) + `ApiError` |
| `rng` | Mulberry32 RNG, ported call-for-call from `util.ts` |
| `schema` | JSON-Schema validation at the boundary (the single contract) |
| `graph` | the mutable `Host` store (mirrors `GraphIndex`) |
| `matching` | VF2++ subgraph matcher (`match.ts`) |
| `rewrite` | single-rule application (`rewrite.ts`) |
| `engine` | the stateful `step`/`run` loop (`engine.ts`) |
| `api` | one-shot apply entry points (deterministic + seeded) |
| `ffi` | the `gg_*` C ABI |

## Build

Requires the Rust toolchain (`cargo`). On Windows the default `stable-msvc`
toolchain needs the VS C++ build tools + Windows SDK (already used to link the
`cdylib`).

```sh
cargo build                              # -> target/debug/graph_grammar.dll
cargo build --release                    # optimized
cargo build --features generate-header   # also regenerate include/graph_grammar.h via cbindgen
```

The C header is committed at [`include/graph_grammar.h`](include/graph_grammar.h)
and is the source of truth. cbindgen runs only under the `generate-header`
feature (off by default), so ordinary builds — and `cargo publish` — never
recompile the header generator or touch the source tree.

## Conformance

The native port is checked against the **real TypeScript engine**. Fixtures are
generated by running the engine, then the Rust output is compared **up to
id-renaming of created elements** (the engine's `uid()` is volatile) and minus
layout (`x`/`y`). Because both sides perform the same add/delete operations in
the same order, the node/edge lists line up positionally, which recovers the
id-isomorphism exactly ,so generative grammars are conformance-checked too.

```sh
pnpm --filter graph-grammar build      # build the engine dist (once)
npx tsx conformance/generate.ts        # regenerate fixtures from the TS engine
cargo test                             # assert native == TS engine
```

## Cross-language samples

Both load the built `.dll` directly and re-run the conformance check from their
language. The library is located via the `GG_DLL` env var, else by walking up to
`target/debug/`.

```sh
# Python (stdlib ctypes only)
python bindings/python/graph_grammar.py

# C# (P/Invoke)
dotnet run --project bindings/csharp
```

Both should print:

```
graph-grammar version: 1.0.0
PASS [relabel]: native DLL output matches the TypeScript engine.
```