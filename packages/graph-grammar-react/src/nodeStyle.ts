import type { GNode } from 'graph-grammar'

/**
 * Visual appearance of a node on the workbench graph canvas. Every field is an
 * optional override; anything omitted falls back to the built-in default
 * (a label-coloured circle showing the truncated label). A resolver inspects a
 * node's `label` and `props` and returns the overrides it wants , this is how
 * you make, say, an infected person look completely different from a healthy one.
 */
export interface NodeStyle {
  /** Outline shape. Default `"circle"`. */
  shape?: 'circle' | 'square' | 'diamond' | 'triangle' | 'hexagon';
  /** Base radius in graph units. Default `11`. */
  radius?: number;
  /** Fill colour. Default: a stable colour hashed from the node's label. */
  fill?: string;
  /** Border colour. Default: a darkened `fill`. */
  stroke?: string;
  /** Border width in graph units. Default `1.5`. */
  strokeWidth?: number;
  /** An outer status ring drawn just outside the node (e.g. to flag a state). */
  ring?: string;
  /** Text drawn on the node. Default: the (truncated) label; `null` hides it. */
  text?: string | null;
  /** Text colour. Default: auto-contrasted against `fill`. */
  textColor?: string;
  /** A glyph/emoji drawn centred on the node instead of the label text. */
  glyph?: string;
  /** Overall opacity 0–1. Default `1`. */
  opacity?: number;
}

/**
 * Maps a node to a (partial) {@link NodeStyle}. Return `null`/`undefined` to use
 * the default appearance. Pass one to `<Workbench nodeStyle={…}>` (or set
 * `app.nodeStyle`) to customise how the host graph is drawn.
 */
export type NodeStyleResolver = (node: GNode) => NodeStyle | null | undefined
