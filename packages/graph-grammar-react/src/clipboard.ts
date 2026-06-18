import type { Props } from 'graph-grammar'

// ============================================================================
// A tiny in-app clipboard for a *subgraph* (selected nodes + the edges among
// them). Shared by the graph workbench and the rule editor; node positions are
// stored relative to the selection's centroid so a paste can be placed anywhere.
// `extra` carries surface-specific node data (LHS predicates / RHS setProps …)
// so an in-editor copy/paste round-trips losslessly; other surfaces ignore it.
// ============================================================================

export interface ClipNode {
  id: string; // temporary id, local to the clip
  label: string;
  props: Props;
  dx: number; // position relative to the selection centroid
  dy: number;
  extra?: unknown;
}

export interface ClipEdge {
  source: string; // references ClipNode.id
  target: string;
  label: string;
  directed: boolean;
  extra?: unknown;
}

export interface Clip {
  kind: 'graph' | 'lhs' | 'rhs';
  nodes: ClipNode[];
  edges: ClipEdge[];
}

let clip: Clip | null = null

export function setClip (c: Clip | null) {
  clip = c
}
export function getClip (): Clip | null {
  return clip
}
export function hasClip (): boolean {
  return !!clip && clip.nodes.length > 0
}
