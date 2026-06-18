import type { Rule, PropExpr, PatternNode, PatternEdge, RhsNode, RhsEdge } from 'graph-grammar'
import type { AppState } from '../../state.ts'

// Shared, framework-agnostic bits for the rule editor: panel geometry, the
// selection model, and a couple of pure helpers.

/**
 * Labels available to author against: those present in the example/start graph,
 * any that exist in the current (possibly run-evolved) host graph, plus the
 * given rule's own labels. Sorted & de-duped. Offering these as a dropdown lets
 * rules be built from real labels instead of error-prone free typing.
 */
export function hostLabels (app: AppState, rule?: Rule): string[] {
  const set = new Set<string>()
  for (const n of app.grammar.start.nodes) set.add(n.label)
  for (const [label, bucket] of app.engine.index.byLabel) if (bucket.size) set.add(label)
  if (rule) {
    for (const n of rule.lhs.nodes) set.add(n.label)
    for (const n of rule.rhs.nodes) set.add(n.label)
  }
  set.delete('')
  return [...set].sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// Panels. The editor shows the LHS and RHS side-by-side, plus one panel per NAC
// (Negative Application Condition) in a row below. A panel id is "lhs", "rhs",
// or "nac:<index>". NAC panels are "pattern" panels like the LHS , their nodes
// are PatternNodes (label / wildcard / predicates), their edges PatternEdges ,
// but they never participate in the morphism (the engine matches each NAC
// independently and blocks the rule if it's found).
// ---------------------------------------------------------------------------
export type PanelId = 'lhs' | 'rhs' | `nac:${number}`

export const isNac = (p: PanelId): p is `nac:${number}` => p.startsWith('nac:')
export const nacIndex = (p: PanelId): number => Number(p.slice(4))
export const nacId = (i: number): PanelId => `nac:${i}`
/** Pattern panels (LHS + NACs) match the host; the RHS describes the result. */
export const isPattern = (p: PanelId): boolean => p === 'lhs' || isNac(p)

export const R = 22

const LHS_GEOM = { x0: 12, y0: 50, w: 470, h: 470, title: 'LHS · Match pattern' }
const RHS_GEOM = { x0: 558, y0: 50, w: 470, h: 470, title: 'RHS · Result' }
// NAC panels sit in a row beneath the LHS/RHS row.
const NAC_X0 = 12; const NAC_Y0 = 588; const NAC_W = 340; const NAC_H = 300; const NAC_GAP = 28
const BASE_W = 1040; const BASE_H = 540

export interface PanelGeom {
  x0: number;
  y0: number;
  w: number;
  h: number;
  title: string;
}

export function panelGeom (panel: PanelId): PanelGeom {
  if (panel === 'lhs') return LHS_GEOM
  if (panel === 'rhs') return RHS_GEOM
  const i = nacIndex(panel)
  return { x0: NAC_X0 + i * (NAC_W + NAC_GAP), y0: NAC_Y0, w: NAC_W, h: NAC_H, title: `NAC ${i + 1} · Forbidden` }
}

/** Ordered list of panel ids for a rule: lhs, rhs, then one per NAC. */
export function panelIds (rule: Rule): PanelId[] {
  const n = rule.nac?.length ?? 0
  const ids: PanelId[] = ['lhs', 'rhs']
  for (let i = 0; i < n; i++) ids.push(nacId(i))
  return ids
}

/** Short human label for headings ("LHS", "RHS", "NAC 1"). */
export function panelLabel (panel: PanelId): string {
  if (panel === 'lhs') return 'LHS'
  if (panel === 'rhs') return 'RHS'
  return `NAC ${nacIndex(panel) + 1}`
}

/** Overall content size of the SVG (grows to fit the NAC row). */
export function viewSize (rule: Rule): { w: number; h: number } {
  const n = rule.nac?.length ?? 0
  if (n === 0) return { w: BASE_W, h: BASE_H }
  const w = Math.max(BASE_W, NAC_X0 + n * (NAC_W + NAC_GAP) - NAC_GAP + NAC_X0)
  return { w, h: NAC_Y0 + NAC_H + 30 }
}

/** The nodes array for a panel (PatternNodes for lhs/nac, RhsNodes for rhs). */
export function nodesOf (rule: Rule, p: PanelId): (PatternNode | RhsNode)[] {
  if (p === 'lhs') return rule.lhs.nodes
  if (p === 'rhs') return rule.rhs.nodes
  return rule.nac![nacIndex(p)].nodes
}

/** The edges array for a panel. */
export function edgesOf (rule: Rule, p: PanelId): (PatternEdge | RhsEdge)[] {
  if (p === 'lhs') return rule.lhs.edges
  if (p === 'rhs') return rule.rhs.edges
  return rule.nac![nacIndex(p)].edges
}

export type Sel =
  | { kind: 'node'; panel: PanelId; id: string }
  | { kind: 'edge'; panel: PanelId; id: string }
  | { kind: 'map'; rhsNodeId: string }
  | null

export function panelAt (rule: Rule, x: number, y: number): PanelId | null {
  for (const id of panelIds(rule)) {
    const p = panelGeom(id)
    if (x >= p.x0 && x <= p.x0 + p.w && y >= p.y0 && y <= p.y0 + p.h) return id
  }
  return null
}

export function distToSeg (px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/** Lay out any node lacking coordinates on a circle in its panel. Mutates. */
export function ensureLayout (rule: Rule) {
  for (const panel of panelIds(rule)) {
    const nodes = nodesOf(rule, panel)
    const missing = nodes.filter((n) => n.x == null || n.y == null)
    if (!missing.length) continue
    const p = panelGeom(panel)
    const cx = p.w / 2
    const cy = p.h / 2
    const radius = Math.min(p.w, p.h) * 0.32
    missing.forEach((n, i) => {
      if (missing.length === 1) {
        n.x = cx
        n.y = cy
      } else {
        const a = (i / missing.length) * Math.PI * 2 - Math.PI / 2
        n.x = cx + Math.cos(a) * radius
        n.y = cy + Math.sin(a) * radius
      }
    })
  }
}

/** Rebuild the explicit morphism list from RHS nodes' mapFrom pointers. */
export function syncMorphism (rule: Rule) {
  rule.morphism = rule.rhs.nodes
    .filter((n) => n.mapFrom)
    .map((n) => ({ lhsNodeId: n.mapFrom!, rhsNodeId: n.id }))
}

export function defaultExpr (kind: PropExpr['kind']): PropExpr {
  switch (kind) {
    case 'literal':
      return { kind: 'literal', value: '' }
    case 'copy':
      return { kind: 'copy', from: '', key: '' }
    case 'increment':
      return { kind: 'increment', from: '', key: '', by: 1 }
    case 'randInt':
      return { kind: 'randInt', min: 0, max: 10 }
    case 'randFloat':
      return { kind: 'randFloat', min: 0, max: 1 }
    case 'counter':
      return { kind: 'counter' }
  }
}
