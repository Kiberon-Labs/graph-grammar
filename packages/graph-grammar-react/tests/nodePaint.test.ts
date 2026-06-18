import { describe, it, expect } from 'vitest'
import type { GNode } from 'graph-grammar'
import type { NodeStyleResolver } from '../src/nodeStyle.ts'
import { resolveNodeStyle, nodeShapeCorners, traceNodeShape, shapePolygonPoints } from '../src/nodePaint.ts'

const node = (label: string, props: Record<string, unknown> = {}): GNode => ({ id: 'n1', label, props: props as GNode['props'] })

// The same resolver shape the demo app ships for the Infection example.
const infection: NodeStyleResolver = (n) => {
  if (n.label !== 'person') return undefined
  switch (n.props.state) {
    case 'I':
      return { shape: 'diamond', radius: 16, fill: '#fa5252', ring: '#ff8787', glyph: '!', textColor: '#fff' }
    case 'R':
      return { shape: 'circle', radius: 11, fill: '#2f9e44', glyph: '✓', textColor: '#fff' }
    default:
      return { shape: 'circle', radius: 8, fill: '#495057', text: null }
  }
}

describe('resolveNodeStyle', () => {
  it('falls back to label-derived defaults with no resolver', () => {
    const s = resolveNodeStyle(node('A'))
    expect(s.shape).toBe('circle')
    expect(s.opacity).toBe(1)
    expect(typeof s.fill).toBe('string')
    expect(s.stroke).toBeTruthy()
    expect(s.textColor).toBeTruthy()
    // size/text policy fields are left for the view to default
    expect(s.radius).toBeUndefined()
    expect(s.text).toBeUndefined()
    expect(s.glyph).toBeUndefined()
    expect(s.ring).toBeUndefined()
  })

  it('makes the three infection states look substantially different', () => {
    const infected = resolveNodeStyle(node('person', { state: 'I' }), infection)
    expect(infected).toMatchObject({ shape: 'diamond', radius: 16, fill: '#fa5252', ring: '#ff8787', glyph: '!' })

    const recovered = resolveNodeStyle(node('person', { state: 'R' }), infection)
    expect(recovered).toMatchObject({ shape: 'circle', radius: 11, fill: '#2f9e44', glyph: '✓' })

    const susceptible = resolveNodeStyle(node('person', { state: 'S' }), infection)
    expect(susceptible).toMatchObject({ shape: 'circle', radius: 8, fill: '#495057', text: null })

    // the three are genuinely distinct on shape/size/colour
    expect(infected.shape).not.toBe(susceptible.shape)
    expect(infected.radius).toBeGreaterThan(susceptible.radius!)
    expect(new Set([infected.fill, recovered.fill, susceptible.fill]).size).toBe(3)
  })

  it('ignores the resolver for non-matching labels (default look)', () => {
    const s = resolveNodeStyle(node('router'), infection)
    expect(s.shape).toBe('circle')
    expect(s.glyph).toBeUndefined()
    expect(s.ring).toBeUndefined()
  })

  it('text: undefined means use-label, null means hide', () => {
    expect(resolveNodeStyle(node('A')).text).toBeUndefined()
    expect(resolveNodeStyle(node('person', { state: 'S' }), infection).text).toBeNull()
  })
})

describe('nodeShapeCorners', () => {
  it('returns null for a circle (no polygon)', () => {
    expect(nodeShapeCorners('circle', 0, 0, 10)).toBeNull()
    expect(nodeShapeCorners(undefined, 0, 0, 10)).toBeNull()
  })

  it('produces the right corner count and geometry per shape', () => {
    expect(nodeShapeCorners('square', 0, 0, 10)).toHaveLength(4)
    expect(nodeShapeCorners('triangle', 0, 0, 10)).toHaveLength(3)
    expect(nodeShapeCorners('hexagon', 0, 0, 10)).toHaveLength(6)

    const diamond = nodeShapeCorners('diamond', 100, 200, 10)!
    expect(diamond).toHaveLength(4)
    expect(diamond[0]).toEqual([100, 190]) // top vertex
    expect(diamond[1]).toEqual([110, 200]) // right vertex
    expect(diamond[2]).toEqual([100, 210]) // bottom vertex
    expect(diamond[3]).toEqual([90, 200]) // left vertex
  })
})

// A minimal recording 2D context , enough to assert which path ops were issued.
function mockCtx () {
  const calls: string[] = []
  const rec = (name: string) => () => { calls.push(name) }
  return {
    calls,
    beginPath: rec('beginPath'),
    arc: rec('arc'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    closePath: rec('closePath'),
  } as unknown as CanvasRenderingContext2D & { calls: string[] }
}

describe('traceNodeShape', () => {
  it('draws a circle with arc() and no polygon ops', () => {
    const ctx = mockCtx()
    traceNodeShape(ctx, 'circle', 0, 0, 10)
    expect(ctx.calls).toContain('arc')
    expect(ctx.calls).not.toContain('lineTo')
    expect(ctx.calls).not.toContain('closePath')
  })

  it('draws a diamond as a closed 4-point polygon (moveTo + 3×lineTo + closePath)', () => {
    const ctx = mockCtx()
    traceNodeShape(ctx, 'diamond', 0, 0, 10)
    expect(ctx.calls.filter((c) => c === 'moveTo')).toHaveLength(1)
    expect(ctx.calls.filter((c) => c === 'lineTo')).toHaveLength(3)
    expect(ctx.calls).toContain('closePath')
    expect(ctx.calls).not.toContain('arc')
  })

  it('draws a hexagon as a closed 6-point polygon', () => {
    const ctx = mockCtx()
    traceNodeShape(ctx, 'hexagon', 0, 0, 10)
    expect(ctx.calls.filter((c) => c === 'lineTo')).toHaveLength(5) // moveTo + 5 lineTo = 6 vertices
  })
})

describe('shapePolygonPoints (SVG)', () => {
  it('returns null for a circle and a points string otherwise', () => {
    expect(shapePolygonPoints('circle', 0, 0, 10)).toBeNull()
    const pts = shapePolygonPoints('diamond', 100, 200, 10)!
    expect(pts.split(' ')).toHaveLength(4)
    expect(pts.startsWith('100.00,190.00')).toBe(true)
  })
})
