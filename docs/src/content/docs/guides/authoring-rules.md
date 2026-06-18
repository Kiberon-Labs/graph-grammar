---
title: Authoring rules
description: Practical recipes for building rules , predicates, deletion, node merging, property expressions, and NACs.
---

These recipes use the [builders DSL](/reference/api/#builders-dsl)
(`pn`, `pe`, `rn`, `re`, `emb`, `rule`). See [Core concepts](/explanation/concepts/)
for the underlying model.

## Match by property predicate

Match only nodes whose `state` property equals `"I"` (infected):

```ts
import { rule, pn, pe, rn, re } from "graph-grammar";

const infect = rule({
  name: "infect-neighbour",
  lhs: {
    nodes: [
      pn("i", "P", { predicates: [{ key: "state", op: "eq", value: "I" }] }),
      pn("s", "P", { predicates: [{ key: "state", op: "eq", value: "S" }] }),
    ],
    edges: [pe("e", "i", "s")],
  },
  rhs: {
    nodes: [
      rn("i", "P", { mapFrom: "i" }),
      // preserve s but flip its state to infected
      rn("s", "P", { mapFrom: "s", setProps: { state: { kind: "literal", value: "I" } } }),
    ],
    edges: [re("e", "i", "s", { mapFrom: "e" })],
  },
  probability: 0.3, // each found match fires 30% of the time
});
```

## Delete a node

Omit an LHS node from the RHS (no RHS node maps from it) and it's deleted. Its
dangling edges are handled by [embedding](/explanation/concepts/#edge-embedding).

```ts
const prune = rule({
  name: "prune-leaf",
  lhs: {
    nodes: [pn("p", "Node"), pn("leaf", "Leaf", { predicates: [{ key: "dead", op: "exists" }] })],
    edges: [pe("e", "p", "leaf")],
  },
  rhs: {
    nodes: [rn("p", "Node", { mapFrom: "p" })], // leaf has no RHS node → deleted
    edges: [],
  },
  // default embedding will `remove` the dangling edge since nothing new is created
});
```

## Merge two nodes (contraction)

Delete a neighbour but keep its connections by redirecting its dangling edges to
the surviving node with `emb(..., "redirectTo")`:

```ts
import { emb } from "graph-grammar";

const merge = rule({
  name: "merge",
  lhs: {
    nodes: [pn("x", "X"), pn("y", "*", { wildcard: true })],
    edges: [pe("e", "x", "y")],
  },
  rhs: {
    nodes: [rn("x", "X", { mapFrom: "x" })], // y deleted
    edges: [],
  },
  embedding: [emb("y", "redirectTo", { targetRhsNodeId: "x" })],
});
```

## Compute properties on created nodes

Give children an incremented depth and a unique id from the global counter:

```ts
import { incProp, counter, lit } from "graph-grammar";

rn("child", "Node", {
  setProps: {
    depth: incProp("parent", "depth", 1), // parent.depth + 1
    n: counter(),
    kind: lit("branch"),
  },
});
```

## Forbid a match with a NAC

Add a negative application condition so a rule only fires when a pattern is
**absent**. NACs are extra `PatternGraph`s on the rule's `nac` array; they share
node ids with the LHS to anchor the forbidden context:

```ts
const openOnce = rule({
  name: "open-room",
  lhs: { nodes: [pn("r", "Room")], edges: [] },
  rhs: { nodes: [rn("r", "Open", { mapFrom: "r" })], edges: [] },
  // don't open a Room that's already guarded by a Lock
  nac: [{ nodes: [pn("r", "Room"), pn("l", "Lock")], edges: [pe("g", "l", "r")] }],
});
```
