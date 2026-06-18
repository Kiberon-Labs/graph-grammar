---
title: Core concepts
description: The full data model , graphs, rules, morphism, embedding, predicates, NACs, and property expressions.
---

This page explains the model the engine operates on. It mirrors the types
exported from the library (see the [API reference](/reference/api/)).

## Graphs

A **graph** is `{ nodes, edges }`.

- A **node** (`GNode`) has an `id`, a `label` (the primary matching key), and a
  `props` bag of arbitrary values (`string | number | boolean | null`).
- An **edge** (`GEdge`) has an `id`, `source`, `target`, `label`, `props`, and a
  `directed` flag.

The graph being rewritten is the **host graph**. A grammar's starting graph is
its **axiom**.

## Rules

A **rule** maps a left-hand side to a right-hand side.

### LHS , the pattern

The LHS is a `PatternGraph`. Beyond labels, pattern elements can carry:

- **Wildcards** , `label: "*"` (or `wildcard: true`) matches any label.
- **Property predicates** , `age > 30`, `state == "I"`, `exists`, `regex`, `in`,
  etc. (see `PredicateOp`). Both nodes and edges support them.
- **Exact degree** , constrain a pattern node to a precise degree in the host,
  for context-sensitive rules.
- **Any-direction edges** , match an edge regardless of orientation.

### RHS , the result

The RHS is an `RhsGraph`. Each RHS node either:

- **preserves** a matched LHS node , set `mapFrom` to the LHS node's id. Preserved
  nodes may be relabelled and have properties set; or
- is **newly created** , no `mapFrom`.

The rule's **morphism** (LHS↔RHS correspondence) is derived from `mapFrom`.

The three outcomes follow from the mapping:

| LHS node | In RHS via `mapFrom`? | Outcome    |
| -------- | --------------------- | ---------- |
| matched  | yes                   | preserved  |
| matched  | no                    | deleted    |
| ,        | RHS node, no `mapFrom`| created    |

## Edge embedding

When a matched node is **deleted**, its edges to the surrounding host graph would
be left dangling. **Embedding rules** (`EmbeddingRule`) say how to reconnect them:

- `remove` , drop the dangling edges (default when nothing new is created).
- `redirectToAll` , reconnect every dangling edge to all newly-created RHS nodes.
- `redirectTo` , reconnect to one specific RHS node (this is how you author
  node-merging / contraction).

Optional `edgeLabelFilter` and `newEdgeLabel` refine which edges reconnect and
how they're relabelled. If you don't specify embedding, a sensible default is
generated (`defaultEmbedding`).

## Property expressions

When an RHS node is created or preserved, it can **set** properties to a computed
value (`PropExpr`):

- `lit(value)` , a literal.
- `randInt(min, max)` / `randFloat(min, max)` , random values (seeded RNG).
- `counter()` , a global monotonically increasing counter.
- `copyProp(fromId, key)` , copy a property from a bound LHS node.
- `incProp(fromId, key, by)` , e.g. `child.depth = parent.depth + 1`.

## Negative application conditions (NACs)

A rule may declare **NACs** , extra patterns that must **not** exist around a
match for the rule to fire. Use them to express "...unless already connected to a
`Lock`", and similar guards.

## Grammars and runs

A **grammar** bundles an ordered set of rules with a run **configuration**:

- **strategy** , how the engine picks what to apply each step (see
  [Application strategies](/guides/strategies/)).
- **seed** , RNG seed; runs are reproducible.
- **maxSteps** / **maxNodes** , safety bounds. `maxNodes` is a precise budget that
  is never overshot: at the cap, growth rules are skipped while net-zero/shrinking
  rules still fire, so a run resolves to a fixpoint instead of freezing.

Each rule also carries stochastic controls: **weight** (selection bias),
**probability** (chance a found match is actually applied), and
**maxApplications** (a per-run firing cap).
