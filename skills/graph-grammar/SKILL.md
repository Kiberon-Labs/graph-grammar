---
name: graph-grammar
description: Build graph-rewriting systems with the `graph-grammar` engine , author LHS→RHS rewrite rules and run them over a host graph to generate or transform graphs. Use when constructing procedural graph generation, graph transformations, L-systems, network/SCC condensation, model rewriting, state-machine expansion, or any "find a subgraph and replace it" task. Trigger terms: graph grammar, graph rewriting, graph transformation, rewrite rule, subgraph matching/isomorphism, L-system, procedural graph, host graph, morphism, edge embedding, production rule.
---

# Building graph grammars with `graph-grammar`

A **graph grammar** transforms a graph by repeatedly applying **rules**. Each rule has a
left-hand side (**LHS** , a pattern to find) and a right-hand side (**RHS** , what to
replace it with). The engine matches the LHS as a subgraph of a **host graph** and
rewrites it. This is how you express procedural generation, graph cleanup/optimization,
L-systems, and model transformations as small local rules.

`graph-grammar` is a fast, framework-agnostic TypeScript engine (only dep: `zod`).

```sh
npm install graph-grammar
```
```ts
import { rule, grammar, pn, pe, rn, re, emb, Engine } from "graph-grammar";
import { lit, copyProp, incProp, counter, randInt } from "graph-grammar"; // property expressions
```

## The model (read this first)

A graph is `{ nodes: GNode[], edges: GEdge[] }`. A node is `{ id, label, props }`
(`label` is the primary match key; `props` is an arbitrary bag). An edge is
`{ id, source, target, label, props, directed }`.

A **rule** maps LHS → RHS. The **morphism** (which RHS node continues which LHS node) is
derived from each RHS node's `mapFrom`:

| LHS node | referenced by an RHS node's `mapFrom`? | outcome |
| --- | --- | --- |
| matched | yes | **preserved** (kept; may be relabelled, may set props) |
| matched | no  | **deleted** |
| ,        | RHS node with no `mapFrom` | **created** |

When a matched node is **deleted**, its edges to the rest of the host graph would dangle.
**Edge embedding** says what to do with them: `remove` (drop), `redirectTo` a surviving
RHS node (this is how you do node-merging / contraction), or `redirectToAll` new nodes.

The LHS can match more precisely with **property predicates** (`age > 30`, `state == "I"`,
`exists`, `regex`, `in`, …), **wildcards** (`label "*"` or `wildcard: true` matches any
label), **exact degree** (only match a node with exactly N incident edges , a context
condition), and **NACs** (negative application conditions , extra patterns that must NOT
exist for the rule to fire). RHS-created/preserved nodes can compute **property
expressions** (`setProps`): literal, copy-from-a-matched-node, increment, counter, random.

## Builders (author rules with these, not raw objects)

```ts
pn(id, label, { props?, predicates?, wildcard? })          // LHS pattern node
pe(id, source, target, { label?, directed?, anyDirection?, predicates? }) // LHS pattern edge
rn(id, label, { mapFrom?, setProps?, props? })             // RHS node (mapFrom = preserve an LHS node)
re(id, source, target, { label?, directed?, mapFrom? })    // RHS edge
emb(lhsNodeId, strategy, { targetRhsNodeId?, edgeLabelFilter?, newEdgeLabel? }) // embedding
rule({ name, lhs, rhs, embedding?, nac?, weight?, probability?, priority?, maxApplications?, description?, color? })
grammar(name, rules, start, { strategy?, seed?, maxSteps?, maxNodes? })
// property expressions for rn(...).setProps:
lit(value) · copyProp(fromLhsId, key) · incProp(fromLhsId, key, by?) · counter() · randInt(min, max)
```

- predicate ops: `exists absent eq neq gt gte lt lte contains regex in`
- embedding strategies: `remove` · `redirectTo` · `redirectToAll`
- a pattern node's `exactDegree` and an edge's `anyDirection` are set on the object
  (e.g. `r.lhs.nodes[0].exactDegree = 4`).

## Minimal example (L-system growth)

```ts
import { rule, grammar, pn, rn, re, Engine } from "graph-grammar";

// A "bud" becomes a stem segment plus a new bud , repeated, this grows a stalk.
const grow = rule({
  name: "bud grows",
  lhs: { nodes: [pn("b", "bud")], edges: [] },
  rhs: {
    nodes: [rn("s", "stem", { mapFrom: "b" }), rn("b2", "bud")], // preserve b as stem, create a bud
    edges: [re("e", "s", "b2", { label: "grows", directed: true })],
  },
});

const start = { nodes: [{ id: "1", label: "bud", props: {} }], edges: [] };
const engine = new Engine(grammar("plant", [grow], start, { strategy: "random", maxSteps: 50, maxNodes: 60 }));
engine.run();
console.log(engine.graph.nodes.length); // grew until the node budget stopped it
```

## Application strategies (`grammar(..., { strategy })`)

| strategy | behaviour |
| --- | --- |
| `random` | weighted-random rule + one random match per step (use `weight`, `probability`, `seed`) |
| `priority` | highest-`priority` applicable rule fires first , good for phased grammars |
| `sequential` | round-robin through the rule list |
| `maximal` | apply all **non-overlapping** matches of one rule per step (parallel rewriting) |

## Authoring checklist (avoid the common traps)

1. **Make it terminate.** A rule must stop matching its own output, or bound it.
   Relabel (LHS `bud` → RHS `stem`+`bud`, not `bud`→`bud`+`bud` forever), match only
   specific labels, or set `maxSteps` / `maxNodes` (a precise node budget; growth rules
   are skipped at the cap while net-zero rules still resolve to a fixpoint).
2. **Directed edges need `{ directed: true }` on BOTH sides.** `pe`/`re` default to
   *undirected*. A directed pattern edge only matches a directed host edge in the same
   direction; set `anyDirection: true` to ignore orientation.
3. **Match-any:** an empty/`""` edge label matches any label; node `wildcard: true`
   (or label `"*"`) matches any label.
4. **Preserve vs create vs delete** is governed entirely by RHS `mapFrom` (table above).
   To merge/contract, delete a node and `emb(id, "redirectTo", { targetRhsNodeId })`.
5. **Stochastic control** is per-rule: `weight` (selection bias), `probability` (chance a
   found match fires), `maxApplications` (cap per run). Runs are reproducible via `seed`.

## Run, inspect, serialize

```ts
const e = new Engine(g);          // clones the start graph , reset/re-run is reproducible
e.run();                          // or e.run(maxSteps, (result, i) => { ... }) for a callback per step
let r = e.step();                 // one rewrite; r.applied, r.createdNodes/Edges, r.deletedNodes/Edges
e.graph;                          // the current host graph
e.reset();                        // back to the axiom

import { importGrammar, exportGrammar, parseGraph, randomGraph, gridGraph } from "graph-grammar";
const json = exportGrammar(g);    // → JSON; importGrammar(json) validates with zod (throws on bad input)
parseGraph("A -> B -> C");        // quick host graphs from edge-list / DOT / JSON
```

## Go deeper

- **`reference.md`** (next to this file) , the full API surface and copy-paste recipes
  (contraction/merge, cycle condensation, predicate-gated transforms, subdivision, NACs,
  property expressions).
- **Worked examples in this repo:** `packages/graph-grammar/src/examples/*.ts` ,
  `network.ts` (SCC/cycle condensation via `redirectTo`), `traffic.ts` (precondition-gated
  upgrades with `exactDegree` + predicates), `tree.ts` (bounded recursion with `incProp`),
  `merge.ts` (contraction), `subdivide.ts` (maximal/parallel), `dungeon.ts` (multi-phase
  `priority` showcase). Each is one self-contained `grammar(...)`.
- **Docs site:** `docs/` (Astro Starlight) , getting-started, core concepts, authoring
  rules, strategies, serialization, and the API reference.
- **Types & schemas:** `import type { Graph, Rule, Grammar, PropExpr, ... } from "graph-grammar"`;
  zod schemas (`GrammarSchema`, `GraphSchema`, …) are exported for runtime validation.
