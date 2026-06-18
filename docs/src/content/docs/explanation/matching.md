---
title: Matching & complexity
description: How the engine solves the subgraph isomorphism problem , the backtracking (VF2/VF2++-flavoured) search, its pruning heuristics, and its big-O cost.
---

Every rewrite step begins by finding where a rule's left-hand side occurs in the
host graph. That is the **subgraph isomorphism problem**, and it is the
performance-critical core of the engine. This page explains the algorithm it uses
and what that costs.

## The problem

Given a small **pattern** graph `P` (a rule's LHS) and a large **host** graph
`H`, find an injective mapping of `P`'s nodes onto `H`'s nodes such that every
pattern edge is realised by a host edge with a compatible label, direction, and
properties. Host nodes and edges that the pattern does not mention are ignored, so
this is the *non-induced* (monomorphism) variant rather than induced subgraph
isomorphism.

Subgraph isomorphism is **NP-complete** in general: there is no known algorithm
that is polynomial in the pattern size for arbitrary inputs. So the engine does
not try to beat the worst case , it leans on the fact that grammar patterns are
*tiny* and host graphs are *sparse*, and structures the search to stay close to
its best case on those inputs.

## The algorithm

The matcher (`findMatches` in `packages/graph-grammar/src/match.ts`) is a
**backtracking tree search in the VF2 / VF2++ family**. It grows a partial
mapping one pattern node at a time, and abandons a branch the moment a constraint
is violated. The three ingredients that make it fast in practice:

1. **Rarest-label seeding (VF2++ "infrequent-label-first").** The first pattern
   node bound is the one with the fewest candidate host nodes , typically the
   rarest label, or a node carrying restrictive predicates. This keeps the top of
   the search tree as narrow as possible, where pruning pays off most. A cheap
   pre-check also bails out immediately if any concrete-label pattern node has no
   matching host nodes at all.

2. **Connectivity-guided variable ordering.** After the seed, each subsequent
   pattern node is chosen so that it is already adjacent to a bound node. Its
   candidate set is therefore just *"the neighbours of an already-bound host
   node"* , bounded by that node's degree, not by the size of the whole graph.

3. **Incremental, allocation-free constraint checks.** Candidate filtering (label,
   predicates, exact-degree, injectivity) and back-edge verification iterate the
   index's internal id-sets directly instead of materialising arrays. Adjacency
   and "edges between two nodes" are answered in O(1) by the `GraphIndex`.

A `GraphIndex` makes all of this possible. It maintains, per host graph:

- `byLabel` , label → bucket of node ids, for candidate pruning;
- `incident` , node id → set of incident edge ids, for neighbour expansion;
- `adjPairs` , unordered node pair → edge ids, for O(1) edge-existence tests.

Building (or rebuilding) the index is **O(V + E)**; it is kept incrementally
consistent across rewrites where practical.

## Complexity

Let

- **V** = number of host nodes, **E** = number of host edges,
- **P** = number of pattern nodes (the LHS size , small and fixed per rule),
- **b** = size of the rarest matching label bucket (the seed candidate count, `b ≤ V`),
- **d** = maximum degree in the host graph.

### Worst case

Backtracking explores partial mappings, and in the pathological case (e.g. a
densely connected host with many indistinguishable nodes) the number of partial
mappings is bounded by the number of ways to place `P` pattern nodes onto `V`
host nodes:

```
O( V! / (V−P)! )  =  O(Vᴾ)
```

with an additional `O(P)` edge-consistency cost at each node placement. This
exponential-in-`P` bound is inherent to the NP-complete problem; no pruning
heuristic removes it for adversarial inputs.

### Practical / typical case

For the inputs grammars actually produce , **small connected patterns over sparse
graphs** , the heuristics collapse that bound dramatically. The seed level
branches over `b` candidates, and every level after it branches only over the
neighbours of an already-bound node (≤ `d`):

```
O( b · dᴾ⁻¹ )
```

Because `P` is small and fixed and sparse graphs have small `d`, the dominant
term is the seed count `b`. Enumerating **all** matches is therefore effectively
**linear in the size of the rarest label class** for connected patterns, plus the
one-time **O(V + E)** index build.

### One random match per step

Stochastic rewriting does not need the full match set , it needs *one* match,
chosen fairly. With an RNG, the seed bucket is walked in pseudo-random order
**lazily**: the `LabelBucket` yields every id exactly once using a coprime stride,
which is **O(1) to start** and never materialises the bucket. So `findOneMatch`
(used for one-match-per-step rewriting) costs about

```
O( dᴾ⁻¹ )
```

per step in the typical case , **independent of how many matches exist**. This is
the difference between O(matches) and roughly O(depth) per rewrite, and it is what
keeps parallel-growth grammars (where the match count explodes as the graph grows)
fast.

| Operation | Typical cost | Worst case |
| --- | --- | --- |
| Build / rebuild index | `O(V + E)` | `O(V + E)` |
| Find all matches (connected pattern) | `O(b · dᴾ⁻¹)` | `O(Vᴾ · P)` |
| Find one random match | `O(dᴾ⁻¹)` | `O(Vᴾ · P)` |
| Adjacency / edge-between test | `O(1)` | `O(1)` |

## Why this matters

A graph grammar applies many rules over many steps, re-matching as the host graph
grows. Choosing a VF2/VF2++-style backtracker over a naive product-and-filter
search , and pairing it with an O(1) index and lazy random seeding , is what lets
the engine apply one rewrite in time that depends on the *pattern* and *local
degree*, not on the ever-growing match set or host size.

See [Core concepts](/explanation/concepts/) for the data model the matcher
operates on, and the [API reference](/reference/api/) for the exported types.
