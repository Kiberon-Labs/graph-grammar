# graph-grammar , reference & recipes

Full API surface and working patterns. Read `SKILL.md` first for the model.

## Data model

```ts
type PropValue = string | number | boolean | null;
interface GNode { id: string; label: string; props: Record<string, PropValue>; x?: number; y?: number }
interface GEdge { id: string; source: string; target: string; label: string; props: Props; directed: boolean }
interface Graph { nodes: GNode[]; edges: GEdge[] }
```
Build host nodes/edges by hand (`{ id, label, props: {} }`) or with `makeNode(label, props?)`
/ `makeEdge(source, target, label?, directed?)` (these mint unique ids).

## Builders

```ts
pn(id, label, opts?): PatternNode
  opts: { props?, predicates?: PropPredicate[], wildcard?: boolean }
pe(id, source, target, opts?): PatternEdge
  opts: { label?: string, directed?: boolean /*=false*/, anyDirection?: boolean, predicates?: PropPredicate[] }
rn(id, label, opts?): RhsNode
  opts: { mapFrom?: string, setProps?: Record<string, PropExpr>, props? }
re(id, source, target, opts?): RhsEdge
  opts: { label?, directed?: boolean /*=false*/, mapFrom?: string }
emb(lhsNodeId, strategy, opts?): EmbeddingRule
  strategy: "remove" | "redirectTo" | "redirectToAll"
  opts: { targetRhsNodeId?: string, edgeLabelFilter?: string, newEdgeLabel?: string }
rule(spec): Rule
  spec: { name, lhs: {nodes,edges}, rhs: {nodes,edges},
          embedding?: EmbeddingRule[], nac?: PatternGraph[],
          weight?=1, probability?=1, priority?=0, maxApplications?=0 /*0=∞*/,
          enabled?=true, description?, color? }
grammar(name, rules, start, config?): Grammar
  config: { strategy?="random", seed?=12345, maxSteps?=300, maxNodes?=0 /*0=unbounded*/ }
```

Set-on-object (no builder arg): `patternNode.exactDegree = N | null`,
`patternEdge.anyDirection = true`. `defaultEmbedding(lhs, rhs)` auto-generates sensible
embedding if you omit `rule({ embedding })`.

## Predicates

`pn("n", "Node", { predicates: [{ key, op, value? }] })`. Ops:

```
exists, absent            , key present / absent (no value)
eq, neq                   , equals / not-equals
gt, gte, lt, lte          , numeric comparison
contains                  , substring (string value)
regex                     , value is a regex source string
in                        , value is an array; prop ∈ array
```

## Property expressions (RHS `setProps`)

`rn("c", "Child", { setProps: { depth: incProp("p", "depth", 1) } })`. Helpers:

```
lit(value)                    , a literal
copyProp(fromLhsId, key)      , copy a prop from a matched (bound) LHS node
incProp(fromLhsId, key, by=1) , matched node's numeric prop + by  (e.g. child.depth = parent.depth + 1)
counter()                     , global monotonically-increasing integer
randInt(min, max)             , random integer (uses the grammar seed)
```
`randFloat` exists as a kind: `{ kind: "randFloat", min, max }` (no helper).

## Engine

```ts
const e = new Engine(grammar, startOverride?);   // clones the start graph
e.step(): RewriteResult                           // one rewrite
e.run(maxSteps?, onStep?): number                 // returns steps applied; honours config bounds
e.reset(startOverride?): void
e.graph: Graph                                    // current host graph (getter)
e.steps: number
e.matchCounts(cap=200): Record<ruleId, number>    // per-rule live match counts (for UIs)

interface RewriteResult { applied: boolean; ruleId?; match?; createdNodes; createdEdges; deletedNodes; deletedEdges }
```
Also standalone: `findMatches(ruleId, lhs, index)`, `hasMatch`, `countMatches`,
`applyRule(index, rule, match, ctx)` over a `new GraphIndex(graph)`.

## Serialization & generators

```ts
exportGrammar(g) / exportGraph(g)        → pretty JSON string
importGrammar(text)                      → validates with zod; THROWS on invalid
safeImportGrammar(text)                  → { ok: true, grammar } | { ok: false, error }
parseGraph(text)                         → Graph from JSON | edge-list ("A -> B", "A -- B") | DOT-lite
randomGraph(n, edgeFactor, labels)       / gridGraph(cols, rows, label?)
```

---

# Recipes

## 1. Bounded recursion (binary tree, depth via incProp)

```ts
const split = rule({
  name: "leaf splits",
  probability: 0.9,
  lhs: { nodes: [pn("l", "leaf", { predicates: [{ key: "depth", op: "lt", value: 5 }] })], edges: [] },
  rhs: {
    nodes: [
      rn("n", "node", { mapFrom: "l" }),
      rn("a", "leaf", { setProps: { depth: incProp("l", "depth", 1) } }),
      rn("b", "leaf", { setProps: { depth: incProp("l", "depth", 1) } }),
    ],
    edges: [re("la", "n", "a", { directed: true }), re("lb", "n", "b", { directed: true })],
  },
});
// start: [{ id: "r", label: "leaf", props: { depth: 0 } }]; the depth<5 predicate stops growth.
```

## 2. Contraction / node-merge (the canonical embedding use)

```ts
import { emb } from "graph-grammar";
const merge = rule({
  name: "merge neighbour into X",
  lhs: { nodes: [pn("x", "X"), pn("y", "*", { wildcard: true })],
         edges: [pe("e", "x", "y", { anyDirection: true })] },
  rhs: { nodes: [rn("x", "X", { mapFrom: "x" })], edges: [] },     // y deleted
  embedding: [emb("y", "redirectTo", { targetRhsNodeId: "x" })],   // y's other edges rewire onto X
});
```

## 3. Cycle / SCC condensation (directed)

```ts
// 2-cycle A⇄B → one node:
const collapse2 = rule({
  name: "collapse mutual",
  lhs: { nodes: [pn("a","*",{wildcard:true}), pn("b","*",{wildcard:true})],
         edges: [pe("ab","a","b",{directed:true}), pe("ba","b","a",{directed:true})] },
  rhs: { nodes: [rn("a","R",{mapFrom:"a"})], edges: [] },
  embedding: [emb("b","redirectTo",{targetRhsNodeId:"a"})],
});
// 3-cycle A→B→C→A → one node: same shape with pn c + pe bc/ca, delete b & c, redirect both to a.
// Run under strategy "priority" with the 3-cycle at higher priority. Acyclic structure never matches.
```

## 4. Precondition-gated transform (property + exact degree)

```ts
const r = rule({
  name: "busy 4-way → roundabout",
  lhs: { nodes: [pn("j", "stop", { predicates: [{ key: "traffic", op: "eq", value: "high" }] })], edges: [] },
  rhs: { nodes: [rn("j", "roundabout", { mapFrom: "j" }) /* + ring nodes/edges */], edges: [] },
});
(r.lhs.nodes[0] as any).exactDegree = 4;  // only a node with exactly 4 incident edges matches
// Relabelling "stop"→"roundabout" makes it stop re-matching → terminates.
```

## 5. Edge subdivision (maximal / parallel)

```ts
const sub = rule({
  name: "subdivide",
  lhs: { nodes: [pn("a", "X"), pn("b", "X")], edges: [pe("e", "a", "b")] },
  rhs: { nodes: [rn("a", "X", { mapFrom: "a" }), rn("b", "X", { mapFrom: "b" }), rn("m", "M")],
         edges: [re("e1", "a", "m"), re("e2", "m", "b")] },
});
// grammar(..., { strategy: "maximal" }) inserts one M per X–X edge in parallel.
// Matching only X–X (not the new X–M edges) keeps it from re-subdividing its output.
```

## 6. NAC guard (fire only when something is absent)

```ts
const open = rule({
  name: "open room",
  lhs: { nodes: [pn("r", "Room")], edges: [] },
  rhs: { nodes: [rn("r", "Open", { mapFrom: "r" })], edges: [] },
  // don't open a Room already guarded by a Lock (NAC shares node id "r" to anchor):
  nac: [{ nodes: [pn("r", "Room"), pn("l", "Lock")], edges: [pe("g", "l", "r")] }],
});
```

## Building a grammar from scratch , procedure

1. Define the **vocabulary**: node labels (states/types) and edge labels.
2. Write the **start graph** (the axiom).
3. For each transformation, write a rule: LHS = the trigger pattern (+ predicates / exact
   degree / NAC for preconditions), RHS = the result (mark preserved nodes with `mapFrom`,
   add created nodes/edges, set props), and `embedding` for any deleted node's edges.
4. Pick a **strategy** and bounds (`maxSteps`, `maxNodes`, `seed`).
5. `new Engine(grammar(...))`, `.run()`, inspect `.graph`. Iterate. Confirm it **terminates**
   (reaches a fixpoint) , most authoring bugs are non-termination or a directed-edge that
   forgot `{ directed: true }`.
