import type { GNode } from 'graph-grammar'
import type { NodeStyle, NodeStyleResolver } from './nodeStyle.ts'
import { labelColor, darken, textOn } from './colors.ts'

// Pure helpers shared by both node renderers , the d3 host canvas (2D context)
// and the rule editor (SVG). Keeping them here, free of any DOM/React, means the
// appearance logic is unit-testable and the two views draw identical shapes.

export interface ResolvedNodeStyle {
  /** Outline shape (always concrete). */
  shape: NonNullable<NodeStyle['shape']>;
  /** Body fill (always concrete). */
  fill: string;
  /** Border colour (always concrete). */
  stroke: string;
  /** Label / glyph colour (always concrete). */
  textColor: string;
  /** Opacity 0–1 (always concrete). */
  opacity: number;
  // Size- and text-policy fields are left as the resolver gave them (possibly
  // undefined) so each view applies its own default , the host canvas and the
  // editor use different base sizes and label-truncation rules.
  radius?: number;
  strokeWidth?: number;
  text?: string | null;
  glyph?: string;
  ring?: string;
}

/**
 * Merge a resolver's overrides for `node` with the label-derived defaults.
 * Returns concrete colours/shape/opacity; leaves radius/strokeWidth/text/glyph
 * as supplied (the view fills those defaults). Pure , `resolver` must be too.
 */
export function resolveNodeStyle (node: GNode, resolver?: NodeStyleResolver | null): ResolvedNodeStyle {
  const s: NodeStyle | null = (resolver && resolver(node)) || null
  const fill = s?.fill ?? labelColor(node.label)
  return {
    shape: s?.shape ?? 'circle',
    fill,
    stroke: s?.stroke ?? darken(fill),
    textColor: s?.textColor ?? textOn(fill),
    opacity: s?.opacity ?? 1,
    radius: s?.radius,
    strokeWidth: s?.strokeWidth,
    text: s?.text,
    glyph: s?.glyph,
    ring: s?.ring,
  }
}

/**
 * Corner points for a node shape centred at (x,y) with "radius" r, or `null`
 * for a circle. The single source of truth for node geometry, used by both the
 * canvas path tracer and the SVG polygon renderer.
 */
export function nodeShapeCorners (
  shape: NodeStyle['shape'],
  x: number,
  y: number,
  r: number
): Array<[number, number]> | null {
  switch (shape) {
    case 'square':
      return [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]
    case 'diamond':
      return [[x, y - r], [x + r, y], [x, y + r], [x - r, y]]
    case 'triangle':
      return [[x, y - r], [x + r * 0.92, y + r * 0.62], [x - r * 0.92, y + r * 0.62]]
    case 'hexagon': {
      const pts: Array<[number, number]> = []
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r])
      }
      return pts
    }
    default:
      return null // circle
  }
}

/** Trace a node shape onto a 2D canvas path (then fill/stroke it). */
export function traceNodeShape (
  ctx: CanvasRenderingContext2D,
  shape: NodeStyle['shape'],
  x: number,
  y: number,
  r: number
) {
  ctx.beginPath()
  const corners = nodeShapeCorners(shape, x, y, r)
  if (!corners) {
    ctx.arc(x, y, r, 0, Math.PI * 2)
    return
  }
  for (let i = 0; i < corners.length; i++) {
    const [px, py] = corners[i]
    if (i) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  }
  ctx.closePath()
}

/** SVG `points` string for a non-circle shape, or `null` for a circle. */
export function shapePolygonPoints (shape: NodeStyle['shape'], x: number, y: number, r: number): string | null {
  const corners = nodeShapeCorners(shape, x, y, r)
  return corners ? corners.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(' ') : null
}
