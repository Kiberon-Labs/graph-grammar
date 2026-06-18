# graph-grammar

A fast, framework-agnostic **graph rewriting** (graph grammar) engine for
TypeScript. Author rewrite **rules** , a left-hand-side *pattern* to find and a
right-hand-side *result* to replace it with , and apply them to a host graph:
subgraph matching, edge embedding, negative application conditions, property
expressions, and stochastic/parallel application strategies.

The only runtime dependency is [`zod`](https://zod.dev) (used for validated
import/export). No DOM, React, or D3 , runs in Node, the browser, or a worker.

```sh
npm install graph-grammar
```

> ESM-only. Ships TypeScript types.

## Quick start

```ts
import { rule, pn, pe, rn, re, grammar, Engine } from "graph-grammar";

// Rule: every A,A edge gains a B in the middle (A,B,A).
const subdivide = rule({
  name: "subdivide",
  lhs: { nodes: [pn("a", "A"), pn("b", "A")], edges: [pe("e", "a", "b")] },
  rhs: {
    nodes: [rn("a", "A", { mapFrom: "a" }), rn("mid", "B"), rn("b", "A", { mapFrom: "b" })],
    edges: [re("e1", "a", "mid"), re("e2", "mid", "b")],
  },
});

const start = {
  nodes: [{ id: "1", label: "A", props: {} }, { id: "2", label: "A", props: {} }],
  edges: [{ id: "x", source: "1", target: "2", label: "", directed: false, props: {} }],
};

const engine = new Engine(grammar("demo", [subdivide], start, { strategy: "maximal", maxSteps: 3 }));
engine.run();
console.log(engine.graph.nodes.length);
```

## Features

- **Expressive rules** , label + wildcard matching, property predicates
  (`>`, `==`, `regex`, `in`, `exists`, …), exact-degree context, NACs.
- **Edge embedding** , control what happens to a deleted node's edges
  (`remove`, `redirectTo`, `redirectToAll`) , including node merging/contraction.
- **Property expressions** , literals, seeded randoms, a global counter, copy and
  increment from matched nodes (`child.depth = parent.depth + 1`).
- **Strategies** , `random` (weighted/stochastic), `priority` (phased),
  `sequential`, and `maximal` (parallel rewriting).
- **Validated I/O** , `importGrammar` / `exportGrammar` with `zod` schemas
  exported for your own runtime checks.
- **Fast** , O(1) label buckets, an allocation-free VF2-style matcher, and
  single-match rewriting keep parallel-growth grammars **O(N)**.

## Documentation

Full guides and API reference: **[the docs site](https://gg.kiberonlabs.com)** (see the repository).

- Getting started, core concepts, authoring rules, application strategies,
  serialization & validation, and the complete API reference.

## Examples

Ready-to-run example grammars (L-systems, infection spread, binary trees, a
dungeon generator, …) ship behind a subpath so they tree-shake away when unused:

```ts
import { buildExample, EXAMPLES } from "graph-grammar/examples";

const dungeon = buildExample("dungeon");
```

## License

MIT
