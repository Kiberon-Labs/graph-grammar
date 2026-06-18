---
title: Planning & search
description: Use a grammar as a planner , model world state as a graph, actions as rules, and choose between greedy forward rewriting and backtracking search.
---

A grammar is a **state-transition relation**: each rule says "if the world looks
like this (LHS), it may become this (RHS)". That's exactly what a planner needs.
Model the world as the host graph, write one rule per action, and a *plan* is a
sequence of rewrites from the start graph to a goal state. The two
**Planner** examples show this end to end.

## Facts: properties or nodes?

There are two ways to represent a resource like "3 eggs", and they suit
different things.

**As a property** , a `Pantry` node with `{ eggs: 3, money: 5 }`. Compact, easy
to read and edit in the inspector, and natural for **bulk or continuous**
quantities (money, temperature, a large count). "Need 2 eggs" is a predicate
(`eggs ≥ 2`); "use 2" is an arithmetic effect (`eggs −= 2`). This is the
*Bake a Cake* example.

**As nodes** , one `Egg` node per egg, hung off the kitchen with `has` edges.
This is the more *native* representation for a graph-rewriting engine: "do I
have 2 eggs?" becomes a **subgraph match** on two `Egg` nodes, and "use them"
becomes node **deletion** , the engine's core operations, no arithmetic. You
also *see* the larder empty as the plan runs. This is the *Cake vs Bread*
example. The trade-off is clutter: a hundred eggs means a hundred nodes.

Rule of thumb: **discrete, individually-meaningful items → nodes; bulk or
continuous quantities → props.** A real model often mixes both (egg nodes, a
money prop).

## Detecting whether the goal is reachable

Put the objective in the graph , a `Goal` node with `status: "open"` , and a
high-priority rule that flips it to `"achieved"` the moment the goal condition
holds (e.g. a `Cake` node exists):

```ts
rule({
  name: "Goal reached: a Cake exists",
  priority: 100, // fire as soon as it's true, before anything else
  lhs: { nodes: [pn("g", "Goal", { predicates: [{ key: "status", op: "eq", value: "open" }] }), pn("c", "Cake")], edges: [] },
  rhs: { nodes: [rn("g", "Goal", { mapFrom: "g", setProps: { status: lit("achieved") } }), rn("c", "Cake", { mapFrom: "c" })], edges: [] },
});
```

Gate every other rule on the goal still being `open`, and the run halts the
instant it's met. **A run that ends `achieved` found a plan; one that halts with
the goal still `open` proves the goal is unreachable from those facts.**

## Forward (greedy) vs backtracking

This is the important distinction, and the reason there are two ways to drive
the same grammar.

### Forward, greedy , the `Engine`

`Engine.run()` applies rules **forward and commits**: each step picks one
applicable rule (by your strategy , `priority`, `random`, …) and never undoes
it. It's fast, it animates, and it's perfect for simulation and generative
grammars. As a planner it has two faces:

- **Self-repair works great.** If an action is blocked, a *lower-priority*
  recovery rule can fire instead (buy more, substitute an ingredient), and the
  plan repairs itself and continues. The *Bake a Cake* example starts one stick
  of butter short and buys more mid-run, with no backtracking needed.
- **But it can dead-end.** When reaching the goal requires *not* taking an
  action that's currently applicable, greedy commitment fails. In *Cake vs
  Bread*, one `Flour` is shared by both recipes and kneading dough outranks
  making batter , so the greedy run grabs the flour for **bread** and can then
  never make the **cake**, halting with the goal still open. Lower the bread
  rule's priority and greedy succeeds; greedy is simply *fragile to the
  ordering*.

### Backtracking , `plan()`

When you need completeness, drive the **same rules** with the backtracking
search instead. `plan()` runs a depth-first search over the rewrite relation:
try a rule, recurse, and on a dead end **undo it and try the next option**.

```ts
import { plan, hasNodeLabeled, buildExample } from "graph-grammar";
// (examples come from "graph-grammar/examples")

const grammar = buildExample("planner-paths");
const result = plan(grammar, hasNodeLabeled("Cake"));

result.found;          // true , a plan exists
result.steps;          // [{ ruleName: "Make batter…" }, { ruleName: "Bake cake…" }]
result.graph;          // the goal-state graph
result.statesExplored; // search effort (it had to back out of the bread branch)
```

`plan()` tries rules in **priority order**, so the first branch it explores is
exactly what the greedy `priority` strategy would do , which is what lets you
show "greedy fails here, backtracking succeeds" on one grammar. It searches by
**iterative deepening**, so `steps` is the *shortest* plan , a replay never
includes a wasted detour. It's bounded by `maxDepth` / `maxStates` so an
unsolvable problem still terminates with `found: false`.

`result.frames` holds the graphs along the winning path (`[start, …, goal]`),
which is what lets the workbench **replay** the plan on the canvas.

The rules never change , only the control strategy does. That separation is the
point: **the grammar is the transition relation; forward rewriting and
backtracking search are two ways to explore it.**

## In the workbench

The two planner examples (*Cake vs Bread* and *Pick a Dish*) put a **goal**
control in the Run panel , it appears whenever a grammar has a `Goal` node with
a `want` prop. Pick a target dish (the dropdown reads the Goal's `options`), then
hit **Find plan → …**: the workbench runs `plan()` and **replays the solution**
on the canvas, step by step, highlighting each rewrite. Compare it with the
greedy **Run to end** right above:

- *Pick a Dish* , five recipes collide over scarce ingredients. **Run to end**
  greedily bakes cookies until it runs out and never makes your dish; **Find
  plan → Cake** backs out of the cookie/bread dead-ends and crafts exactly the
  cake. Change the dish and it re-plans a different route.

## See also

- [Authoring rules](/guides/authoring-rules/) , predicates, `setProps`, NACs.
- [Application strategies](/guides/strategies/) , the forward strategies
  (`priority`, `random`, `sequential`, `maximal`).
