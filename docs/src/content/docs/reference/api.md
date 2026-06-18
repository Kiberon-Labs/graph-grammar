---
title: API reference
description: The public API exported from graph-grammar and graph-grammar/examples.
---

Everything below is exported from the package root unless noted. The large
example grammars live behind a separate subpath so they tree-shake away when
unused:

```ts
import { Engine, rule, importGrammar } from "graph-grammar";
import { EXAMPLES, buildExample } from "graph-grammar/examples";
```

## Engine

### `class Engine`

Drives a grammar over a host graph.

```ts
const engine = new Engine(grammar, start?);
```

| Member | Signature | Description |
| --- | --- | --- |
| `constructor` | `(grammar: Grammar, start?: Graph)` | Clones the start graph (the axiom is never mutated). |
| `graph` | `get (): Graph` | The current host graph. |
| `steps` | `number` | Rewrite steps taken so far. |
| `step` | `(): RewriteResult` | Apply one rewrite; returns what changed. |
| `run` | `(maxSteps?, onStep?): number` | Run to completion (or a bound); returns steps taken. |
| `reset` | `(start?: Graph): void` | Reset to the axiom (or a new start graph). |
| `matchCounts` | `(cap?): Record<string, number>` | Per-rule match counts, for UI badges. |

A `RewriteResult` reports `applied`, `ruleId`, and the `createdNodes`,
`createdEdges`, `deletedNodes`, `deletedEdges` id arrays.

## Matching

| Export | Signature | Description |
| --- | --- | --- |
| `findMatches` | `(ruleId, lhs, index): Match[]` | All matches of a pattern in the indexed host. |
| `findOneMatch` | `(ruleId, lhs, index, rng?): Match \| null` | A single (optionally random) match. |
| `hasMatch` | `(lhs, index): boolean` | Whether any match exists. |
| `countMatches` | `(lhs, index, cap?): number` | Count matches (optionally capped). |
| `evalPredicate` | `(pred, value): boolean` | Evaluate a single property predicate. |

## Indexing & graph helpers

| Export | Description |
| --- | --- |
| `GraphIndex` | Mutable indexed view of a graph (adjacency, label buckets, incident-edge sets) used by the matcher and rewriter. |
| `makeNode(label, props?, x?, y?)` | Create a `GNode` with a fresh id. |
| `makeEdge(source, target, label?, directed?, props?)` | Create a `GEdge` with a fresh id. |
| `emptyGraph()` | `{ nodes: [], edges: [] }`. |
| `cloneGraph(g)` | Deep clone a graph. |
| `graphStats(g)` | Node/edge counts and label histogram. |

## Rewriting

| Export | Signature | Description |
| --- | --- | --- |
| `applyRule` | `(index, rule, match, ctx): ApplyResult` | Apply a matched rule to the index in place. |

Types: `RewriteContext`, `ApplyResult`.

## Builders DSL

Concise constructors that keep the verbose data model out of hand-written
grammars.

| Export | Signature |
| --- | --- |
| `pn` | `(id, label, opts?) → PatternNode` |
| `pe` | `(id, source, target, opts?) → PatternEdge` |
| `rn` | `(id, label, opts?) → RhsNode` (`opts.mapFrom` to preserve) |
| `re` | `(id, source, target, opts?) → RhsEdge` |
| `emb` | `(lhsNodeId, strategy, opts?) → EmbeddingRule` |
| `rule` | `(spec: RuleSpec) → Rule` (derives the morphism from `mapFrom`) |
| `defaultEmbedding` | `(lhs, rhs) → EmbeddingRule[]` |
| `grammar` | `(name, rules, start, config?) → Grammar` |

Property-expression helpers: `lit(value)`, `randInt(min, max)`, `counter()`,
`copyProp(from, key)`, `incProp(from, key, by?)`.

## Serialization

| Export | Description |
| --- | --- |
| `exportGrammar(g)` / `exportGraph(g)` | Serialize to pretty JSON. |
| `importGrammar(text)` | Parse + validate a grammar; **throws** on invalid input. |
| `safeImportGrammar(text)` | Non-throwing: `{ ok, grammar } \| { ok: false, error }`. |
| `parseGraph(text)` | Parse a graph from JSON, edge-list, or DOT-lite. |
| `randomGraph(n, edgeFactor, labels)` | Generate a random graph. |
| `gridGraph(cols, rows, label?)` | Generate a grid graph. |

See [Serialization & validation](/guides/serialization/).

## Validation schemas (zod)

Every type has a matching schema, kept in lockstep with the TypeScript types at
compile time:

`PropValueSchema`, `PropsSchema`, `GNodeSchema`, `GEdgeSchema`, `GraphSchema`,
`PredicateOpSchema`, `PropPredicateSchema`, `PatternNodeSchema`,
`PatternEdgeSchema`, `PatternGraphSchema`, `PropExprSchema`, `RhsNodeSchema`,
`RhsEdgeSchema`, `RhsGraphSchema`, `EmbeddingStrategySchema`,
`EmbeddingRuleSchema`, `MorphismSchema`, `RuleSchema`, `ApplicationStrategySchema`,
`GrammarConfigSchema`, `GrammarSchema`.

## Utilities

| Export | Description |
| --- | --- |
| `uid(prefix?)` | Generate a unique id. |
| `resetCounter()` | Reset the id counter (deterministic tests). |
| `RNG` | Seeded PRNG (mulberry32). |
| `deepClone(value)` | Structured deep clone. |
| `clamp(x, min, max)` | Clamp a number. |

## Types

All data-model types are exported: `Graph`, `GNode`, `GEdge`, `Props`,
`PropValue`, `PatternGraph`, `PatternNode`, `PatternEdge`, `RhsGraph`, `RhsNode`,
`RhsEdge`, `PropExpr`, `PropPredicate`, `PredicateOp`, `EmbeddingRule`,
`EmbeddingStrategy`, `Rule`, `Morphism`, `RuleSpec`, `Grammar`, `GrammarConfig`,
`ApplicationStrategy`, `Match`, `RewriteResult`.

## `graph-grammar/examples`

| Export | Description |
| --- | --- |
| `EXAMPLES` | Array of `{ key, title, blurb, build }` example entries. |
| `buildExample(key)` | Build a ready-to-run `Grammar` by key (e.g. `"triangle"`, `"plant"`, `"dungeon"`). |
| `ExampleEntry` | The entry type. |
