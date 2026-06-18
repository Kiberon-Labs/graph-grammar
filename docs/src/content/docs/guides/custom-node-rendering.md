---
title: Custom node rendering
description: Draw nodes differently based on their label and properties , shapes, colours, sizes, rings, and glyphs , with the nodeStyle resolver.
---

By default the workbench draws every node as a label-coloured circle. That's
fine for structure, but it hides *state*: in the **Infection Spread** example a
healthy person, an actively infected one, and a recovered one are all identical
"person" circles. You usually want state to be obvious at a glance.

`graph-grammar-react` lets you take over a node's appearance with a single
function , the **`nodeStyle` resolver**. It receives each node (its `label` and
`props`) and returns style overrides. Anything you don't override keeps its
default, so you only describe what changes.

## The `nodeStyle` prop

Pass a resolver to `<Workbench>`:

```tsx
import { AppState, Workbench, type NodeStyleResolver } from "graph-grammar-react";
import "graph-grammar-react/styles.css";

const nodeStyle: NodeStyleResolver = (node) => {
  // Return undefined to keep the default appearance.
  if (node.label !== "person") return undefined;

  switch (node.props.state) {
    case "I": // actively infected , a big red diamond with an alert ring
      return { shape: "diamond", radius: 16, fill: "#fa5252", ring: "#ff8787", glyph: "!", textColor: "#fff" };
    case "R": // recovered / immune , a green circle with a check
      return { shape: "circle", radius: 11, fill: "#2f9e44", glyph: "✓", textColor: "#fff" };
    default: // susceptible , a small muted circle
      return { shape: "circle", radius: 8, fill: "#495057", text: null };
  }
};

const app = new AppState();

export function Editor() {
  return <Workbench app={app} nodeStyle={nodeStyle} />;
}
```

Load the **Infection Spread** example and the three states are now unmistakable:
small grey susceptibles, large red infected diamonds, green recovered circles.
Nodes from other examples don't match `person`, so they keep the default look.

> Using the building blocks instead of `<Workbench>`? Set `app.nodeStyle =
> resolver` on your `AppState` , the canvas reads it from there.

## The resolver

```ts
type NodeStyleResolver = (node: GNode) => NodeStyle | null | undefined;
```

- It's called **per node, per frame**, so keep it cheap , a `switch` on a label
  or prop is ideal. Returning `undefined` (or `null`) is the fast path to the
  default appearance.
- `node` is the live host-graph node: `node.label` plus `node.props` (the same
  properties your rules read and write with predicates and `setProps`). Branch on
  whatever your grammar tracks , `state`, `depth`, `hp`, a boolean flag, etc.

### Where it applies

The resolver styles **both** the host graph canvas (the workbench's main view,
where your grammar runs) **and** the rule-editor canvas, so authoring reflects
how a node will look once it's running. Two editor-specific notes:

- The editor always keeps the **label legible** for authoring , it honours your
  `shape`, `fill`, `stroke`, `ring`, and `glyph`, but ignores a `text: null` /
  `text` override and draws nodes at a uniform size (it's a schematic, not the
  live layout).
- LHS pattern nodes usually express state through **predicates**, not `props`
  (e.g. `state = "I"` is a match condition, not a value on the node). A
  prop-based resolver therefore can't tell those pattern nodes apart , they fall
  to the default branch. Label-based styling (e.g. "a `Boss` is a hexagon")
  shows up in the editor just fine.

## What you can override

Every field of `NodeStyle` is optional; omit a field to keep its default.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `shape` | `"circle" \| "square" \| "diamond" \| "triangle" \| "hexagon"` | `"circle"` | The outline. |
| `radius` | `number` | `11` | Base size, in graph units. |
| `fill` | `string` (CSS colour) | label-hashed colour | The body fill. |
| `stroke` | `string` | a darkened `fill` | Border colour. |
| `strokeWidth` | `number` | `1.5` | Border width, in graph units. |
| `ring` | `string` | , | An outer status ring just outside the node. |
| `text` | `string \| null` | the truncated label | Override the label; `null` hides it. |
| `textColor` | `string` | auto-contrast vs `fill` | Label / glyph colour. |
| `glyph` | `string` | , | A character/emoji centred on the node (replaces `text`). |
| `opacity` | `number` (0–1) | `1` | Fade a node , e.g. to de-emphasise inactive ones. |

Selection, rewrite-highlight, and match-preview outlines are still drawn on top
of your style, so custom nodes stay interactive and the live-rewrite animation
keeps working.

## Recipes

**Numeric property → size or colour.** Scale appearance with a value your rules
maintain (here, a tree node's `depth`):

```ts
const nodeStyle: NodeStyleResolver = (n) => {
  const depth = typeof n.props.depth === "number" ? n.props.depth : 0;
  return { radius: 8 + depth * 2, fill: `hsl(${200 - depth * 18} 70% 55%)` };
};
```

**Flag a condition with a ring** while leaving the rest default:

```ts
const nodeStyle: NodeStyleResolver = (n) =>
  n.props.locked ? { ring: "#ffd43b" } : undefined;
```

**Distinguish types by shape** rather than relying on colour alone (better for
colour-blind readers):

```ts
const byType: Record<string, NodeStyle["shape"]> = {
  Room: "square", Boss: "hexagon", Treasure: "diamond", Key: "triangle",
};
const nodeStyle: NodeStyleResolver = (n) =>
  byType[n.label] ? { shape: byType[n.label] } : undefined;
```

## Performance

The resolver runs on every node each frame, so for large graphs (thousands of
nodes) keep it allocation-light and return early for the common case. The
default render path has **zero** overhead when no `nodeStyle` is set, so you only
pay for the nodes you actually customise.

## See also

- [Embedding the editor](/guides/embedding-the-editor/) , mounting `<Workbench>`
  and the building blocks.
- [Authoring rules](/guides/authoring-rules/) , the predicates and `setProps`
  that put the `props` on your nodes in the first place.
