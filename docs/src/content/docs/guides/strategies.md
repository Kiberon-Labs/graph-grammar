---
title: Application strategies
description: How the engine chooses what to apply each step , random, priority, sequential, and maximal.
---

A grammar's `config.strategy` controls how the engine selects a rule and a match
on each step. Set it when building the grammar:

```ts
const g = grammar("demo", rules, start, { strategy: "priority", seed: 42 });
```

## The four strategies

| Strategy     | Behaviour                                                                          |
| ------------ | --------------------------------------------------------------------------------- |
| `random`     | Weighted-random pick among rules that currently match; **one** match per step.    |
| `priority`   | The highest-`priority` applicable rule fires first , good for phased grammars.     |
| `sequential` | Round-robin through the rule list, one rule per step.                              |
| `maximal`    | Apply as many **non-overlapping** matches of one rule as possible per step (parallel rewriting). |

### `random`

The default. Each rule's **weight** biases selection; each rule's **probability**
gives the chance a found match actually fires. Use weights to make some
productions more common than others, as in L-systems.

### `priority`

Rules are tried in descending `priority`; the first one with a match fires. This
expresses **phases**: e.g. a dungeon grammar opens the spine (high priority),
then branches rooms, then places locks and keys (low priority), each phase
draining before the next begins.

### `sequential`

Steps through the rule list in order, applying one match of the current rule.
Deterministic and easy to reason about for pipelines.

### `maximal`

Finds a maximal set of **non-overlapping** matches of a single rule and applies
them all in one step , true parallel rewriting. This is what you want for
uniform operations like subdividing every edge. Design the LHS so matches can't
overlap (e.g. match `X,X` edges) to guarantee termination.

## Running

```ts
const engine = new Engine(g);

// run to completion (honours maxSteps / maxNodes)
const stepsTaken = engine.run();

// ...or run a bounded burst with a per-step callback
engine.run(25, (result, i) => {
  if (result.applied) console.log(`step ${i}: ${result.ruleId}`);
});

// ...or step manually
const r = engine.step(); // RewriteResult: applied? createdNodes, deletedNodes, ...
```

## Bounds and determinism

- **`maxSteps`** caps total rewrites. Use `-1` for "no cap" (a hard safety bound
  still prevents infinite loops in `run()`).
- **`maxNodes`** is a precise node budget (0 = unbounded). At the cap, rules that
  would grow the graph are skipped while net-zero/shrinking rules still fire, so
  the run resolves to a fixpoint.
- **`seed`** makes stochastic runs reproducible. The same grammar + seed always
  produces the same sequence.
