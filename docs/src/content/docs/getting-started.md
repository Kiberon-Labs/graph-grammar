---
title: Getting started
description: Install graph-grammar, author a rule with the builders DSL, and run the engine.
---

This tutorial builds a tiny grammar by hand and runs it. By the end you'll have
transformed a graph and read the result.

## 1. Install

```sh
npm install graph-grammar
```

The package is ESM-only and ships TypeScript types. Its only runtime dependency
is `zod`.

## 2. Author a rule

We'll write an **edge subdivision** rule: every `A,A` edge gains a `B` in the
middle, becoming `A,B,A`. The [builders DSL](/reference/api/#builders-dsl) keeps
the verbose data model out of hand-written grammars.

```ts
import { rule, pn, pe, rn, re } from "graph-grammar";

const subdivide = rule({
  name: "subdivide",
  // LHS: two A nodes joined by an edge
  lhs: {
    nodes: [pn("a", "A"), pn("b", "A")],
    edges: [pe("e", "a", "b")],
  },
  // RHS: keep both A's (mapFrom), insert a new B between them
  rhs: {
    nodes: [
      rn("a", "A", { mapFrom: "a" }),
      rn("mid", "B"),
      rn("b", "A", { mapFrom: "b" }),
    ],
    edges: [re("e1", "a", "mid"), re("e2", "mid", "b")],
  },
});
```

- `pn(id, label)` / `pe(id, source, target)` build the **L**HS pattern.
- `rn(id, label, { mapFrom })` preserves a matched LHS node; without `mapFrom`
  it's a freshly created node.
- The morphism (which RHS node preserves which LHS node) is derived from
  `mapFrom`, so you don't declare it twice.

## 3. Assemble a grammar and run it

```ts
import { grammar, Engine } from "graph-grammar";

// Host graph: A , A
const start = {
  nodes: [
    { id: "1", label: "A", props: {} },
    { id: "2", label: "A", props: {} },
  ],
  edges: [{ id: "x", source: "1", target: "2", label: "", directed: false, props: {} }],
};

const g = grammar("subdivide-demo", [subdivide], start, {
  strategy: "maximal", // apply all non-overlapping matches each step
  maxSteps: 3,
});

const engine = new Engine(g);
engine.run();

console.log(engine.steps); // number of rewrite steps taken
console.log(engine.graph.nodes.length); // grew as B's were inserted
```

`new Engine(g)` clones the start graph, so running, resetting, and re-running is
always reproducible , the axiom is never mutated in place.

## 4. Step instead of run

For animation or inspection, drive the engine one rewrite at a time:

```ts
const e = new Engine(g);
let result = e.step();
while (result.applied) {
  console.log(result.ruleId, "created", result.createdNodes);
  result = e.step();
}
```

Each `step()` returns a `RewriteResult` describing what changed (created/deleted
node and edge ids) , ideal for highlighting or diffing.

## Next steps

- [Core concepts](/explanation/concepts/) , the full rule model (predicates,
  embedding, NACs, property expressions).
- [Authoring rules](/guides/authoring-rules/) , practical recipes.
- [Application strategies](/guides/strategies/) , `random`, `priority`,
  `sequential`, `maximal`.
- [Serialization & validation](/guides/serialization/) , load and save grammars
  as JSON.
