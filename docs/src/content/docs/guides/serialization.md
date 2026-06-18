---
title: Serialization & validation
description: Load and save grammars and graphs as JSON, with built-in zod validation.
---

The library reads and writes its native **JSON** format, and validates untrusted
input at the boundary with [zod](https://zod.dev) schemas.

## Export

```ts
import { exportGrammar, exportGraph } from "graph-grammar";

const json = exportGrammar(grammar); // pretty-printed JSON string
const graphJson = exportGraph(engine.graph);
```

## Import (validated)

`importGrammar` parses JSON, back-fills the optional top-level fields, and
validates the result against the schema. It **throws** a path-qualified error if
the input can't be made valid:

```ts
import { importGrammar } from "graph-grammar";

try {
  const grammar = importGrammar(jsonString);
} catch (err) {
  console.error(err.message); // e.g. "Invalid grammar: rules.0.enabled: expected boolean"
}
```

For UI flows, prefer the non-throwing variant:

```ts
import { safeImportGrammar } from "graph-grammar";

const res = safeImportGrammar(jsonString);
if (res.ok) {
  use(res.grammar);
} else {
  showError(res.error); // precise, path-qualified message
}
```

## Parse a graph from text

`parseGraph` auto-detects several convenient formats , handy for pasting a quick
host graph:

```ts
import { parseGraph } from "graph-grammar";

parseGraph(`{ "nodes": [...], "edges": [...] }`); // JSON
parseGraph("A -> B -> C");                          // edge list
parseGraph("digraph { A -> B [label=x]; B -> C }"); // DOT-lite
```

A well-formed JSON graph is taken verbatim; loosely-shaped input (numeric ids,
missing `props`) is normalized.

## Validate without importing

The zod schemas are exported directly, so you can validate or narrow data in your
own code:

```ts
import { GrammarSchema, GraphSchema } from "graph-grammar";

const result = GraphSchema.safeParse(unknownValue);
if (result.success) {
  // result.data is a fully-typed Graph
}
```

Every schema corresponds to a type in the [API reference](/reference/api/) ,
`GraphSchema` ↔ `Graph`, `RuleSchema` ↔ `Rule`, and so on. They're kept in lockstep
with the TypeScript types at compile time.

## Generators

For testing and demos:

```ts
import { randomGraph, gridGraph } from "graph-grammar";

const r = randomGraph(50, 1.5, ["A", "B"]); // 50 nodes, ~75 edges, two labels
const g = gridGraph(10, 10);                  // a 10×10 grid
```
