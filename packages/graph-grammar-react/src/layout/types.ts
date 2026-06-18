import type { GNode, GEdge } from 'graph-grammar'

// ============================================================================
// Pluggable graph-layout abstraction. The host-graph renderer talks only to a
// `GraphLayout`, so different engines (force / Dagre / ELK …) can be swapped at
// runtime. The tricky part is bridging two very different models:
//   • force   , a *continuous* physics simulation: ticks every frame, responds
//               to live node dragging (fx/fy pins).
//   • dagre/elk , *one-shot* layered layouts: compute positions once (sync or
//               async) and assign them; dragging just moves the node.
// Both write x/y onto the shared GNode objects, so positions persist when you
// switch engines (and the renderer always draws from x/y).
// ============================================================================

export type LayoutKind = 'force' | 'dagre' | 'elk'

/**
 * A host-graph node as the renderer sees it: the engine's `GNode` (which already
 * carries optional `x`/`y` layout coordinates) plus the transient physics state
 * the force simulation needs. The engine does NOT model pins/velocity , they
 * live here, matching d3's `SimulationNodeDatum`.
 */
export interface SimState {
  index?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}
export type LayoutNode = GNode & SimState

export interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  edge: GEdge;
}

export interface LayoutHandlers {
  /** positions changed → schedule a redraw. */
  onTick: () => void;
  /** layout settled / finished → caller may re-frame the view. */
  onEnd: () => void;
}

export interface GraphLayout {
  readonly kind: LayoutKind;
  /** Does it respond to live node dragging with physics? (force = true) */
  readonly interactive: boolean;
  /** Bind the current node/link set (called whenever the graph changes). */
  setGraph(nodes: LayoutNode[], links: LayoutLink[]): void;
  /** (Re)position. `structural` = the node/edge set changed this update. */
  run(structural: boolean): void;
  /** Explicit full re-layout (the "Re-layout" button). */
  reheat(): void;
  /** A gentle nudge on mount / tab-focus / pin , force re-energises, static no-ops. */
  wake(): void;
  stop(): void;
  // --- drag: force pins via fx/fy; static layouts just move the node ---
  dragStart(n: LayoutNode): void;
  dragMove(n: LayoutNode, x: number, y: number): void;
  dragEnd(n: LayoutNode, pin: boolean): void;
  destroy(): void;
}

export interface LayoutMeta {
  kind: LayoutKind;
  label: string;
  blurb: string;
}

export const LAYOUTS: LayoutMeta[] = [
  { kind: 'force', label: 'Force', blurb: 'Physics simulation , interactive, organic' },
  { kind: 'dagre', label: 'Dagre', blurb: 'Layered / hierarchical , good for DAGs' },
  { kind: 'elk', label: 'ELK', blurb: 'Layered with orthogonal routing' },
]
