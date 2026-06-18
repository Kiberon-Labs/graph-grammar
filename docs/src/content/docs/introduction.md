---
title: Introduction
description: What graph-grammar is and how the library and the workbench relate.
---

**graph-grammar** is a graph rewriting (graph grammar) engine. You describe
transformations as **rules** , a left-hand-side *pattern* to find and a
right-hand-side *result* to replace it with , and the engine repeatedly applies
them to a *host graph*.

It powers everything from L-system-style generative growth to procedural content
generation (dungeons, quests), graph normalization, and model transformation.

## Library vs. workbench

This project ships in two parts:

- **The library** (`graph-grammar`, this documentation) , the framework-agnostic
  engine: matching, rewriting, strategies, serialization. Install it from npm and
  drive it from your own code. Its only runtime dependency is `zod`.
- **The workbench** , an interactive React + D3 app for authoring rules visually
  and watching grammars run. It lives in the same repository (`apps/web`) and is
  built on top of the library. It is **not** published to npm; clone the repo and
  run it if you want the visual editor.

If you just want to transform graphs programmatically, you only need the library.

## A rule, briefly

A rule rewrites part of a graph:

- **LHS (left-hand side)** , the pattern to match. Nodes match by label (or
  wildcard `*`) and optional **property predicates**; edges match by label and
  direction.
- **RHS (right-hand side)** , the result. An RHS node either **preserves** a
  matched LHS node (via `mapFrom`) or is **newly created**. Unmapped LHS nodes are
  **deleted**; unmapped RHS nodes are **created**.
- **Embedding** , when a matched node is deleted, its edges to the rest of the
  graph would dangle; embedding rules say how to reconnect them.

See [Core concepts](/explanation/concepts/) for the full model, or jump to
[Getting started](/getting-started/) to run your first grammar.
