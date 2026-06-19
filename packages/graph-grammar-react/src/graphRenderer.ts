import type { GNode, GEdge } from 'graph-grammar'
import { AppState } from './state.ts'
import { resolveNodeStyle, traceNodeShape } from './nodePaint.ts'
import { makeNode, makeEdge } from 'graph-grammar'
import { findMatches } from 'graph-grammar'
import { setClip, getClip } from './clipboard.ts'
import { flash } from './toast.ts'
import { createLayout, type GraphLayout, type LayoutKind, type LayoutLink, type LayoutNode } from './layout/index.ts'

// ============================================================================
// GraphRenderer — the imperative heart of the host-graph view. This is the one
// piece we deliberately keep OUT of React. Node layout is delegated to a
// pluggable `GraphLayout` (force / Dagre / ELK …); rendering is a single
// <canvas> (no per-element DOM) so thousands of nodes stay interactive. React
// owns the surrounding chrome and talks to this class through a method/callback
// API.
// ============================================================================

/**
 * A render link carries an optional `off`: the signed perpendicular apex offset
 * (in graph units) used to fan out parallel edges so a multigraph's repeated
 * edges between the same pair of nodes don't stack invisibly. 0 / undefined =
 * straight line. The value is assigned per-sync in `assignParallelOffsets`.
 */
type Link = LayoutLink & { off?: number }

// Opacity multipliers applied to "dimmed" nodes/edges — a transient
// visualisation aid that pushes a chosen set into the background so the rest
// stands out. Dimming never changes the graph, only how it's painted.
const DIM_NODE = 0.12
const DIM_EDGE = 0.05

export type GraphMode = 'select' | 'addEdge'

export interface ContextPayload {
  clientX: number;
  clientY: number;
  node: GNode | null;
  edge: GEdge | null;
  graphX: number;
  graphY: number;
}

export interface RendererHandlers {
  onSelect: (node: GNode | null) => void;
  onSelectEdge: (edge: GEdge | null) => void;
  onContextMenu: (p: ContextPayload) => void;
  onModeChange: (mode: GraphMode) => void;
}

export class GraphRenderer {
  private ctx: CanvasRenderingContext2D
  private layout: GraphLayout
  private layoutKind: LayoutKind = 'force'
  private nodes: LayoutNode[] = []
  private links: Link[] = []
  /** Every node ever synced (by id), kept across syncs so a node filtered out of
   *  the layout in respread mode retains its position when it comes back. */
  private known = new Map<string, LayoutNode>()

  private transform = { k: 1, x: 0, y: 0 }
  private dpr = Math.min(window.devicePixelRatio || 1, 2)

  // interaction state
  private brush = 'A'
  private mode: GraphMode = 'select'
  private dragNode: LayoutNode | null = null
  private edgeFrom: LayoutNode | null = null
  private hoverPoint: { x: number; y: number } | null = null
  private panning = false
  private panStart = { x: 0, y: 0, tx: 0, ty: 0 }
  private selectedId: string | null = null
  private selectedEdgeId: string | null = null
  /** multi-selection of node ids (for copy / paste / bulk delete). */
  private selectedIds = new Set<string>()
  /** ids painted at low opacity to recede into the background (viz aid only). */
  private dimmedIds = new Set<string>()
  /** rubber-band marquee in screen px while shift-dragging empty space. */
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null
  private showLabels = true
  /** Edge / node labels the user has switched off. Matching elements are neither
   *  drawn nor hit-tested. An edge also disappears when either endpoint's label is
   *  hidden. By default this is a pure display filter (the elements stay in the
   *  force layout, so toggling never reshuffles positions); when `respread` is on
   *  they are dropped from the layout too, so the graph re-settles around what's
   *  left. */
  private hiddenEdgeLabels = new Set<string>()
  private hiddenNodeLabels = new Set<string>()
  private respread = false
  private previewOn = true
  /** When true, the force sim re-settles whenever a rule rewires edges (bonds
   *  forming/breaking), not only when the node set changes. Turn off to keep the
   *  old behaviour: positions stay put through edge-only rewrites, so a run never
   *  causes a substantial layout shift unless nodes are actually added/removed. */
  private reheatOnEdgeChange = true
  private highlightTTL = 0
  private matchedNodes = new Set<string>()
  private fitAfterSettle = false
  /** edge ids from the previous sync — used to detect when bonds form/break
   *  (a topology change that must reheat the sim even if the node set is fixed). */
  private prevEdgeIds = new Set<string>()

  private scheduled = false
  private raf = 0
  private unsubs: Array<() => void> = []
  private onResize = () => this.resize()
  private onVisibility = () => {
    if (!document.hidden) {
      this.resize()
      this.draw()
      this.layout.wake()
    }
  }

  // Keyboard: Delete removes the selection; Ctrl/Cmd+C/V/A copy/paste/select-all
  // — only when the graph canvas is visible and the user isn't typing in a field.
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.canvas.offsetParent === null) return // graph tab not visible
    const el = document.activeElement as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && (e.key === 'c' || e.key === 'C')) {
      if (this.copySelection()) e.preventDefault()
    } else if (mod && (e.key === 'v' || e.key === 'V')) {
      this.paste()
      e.preventDefault()
    } else if (mod && (e.key === 'a' || e.key === 'A')) {
      this.selectAll()
      e.preventDefault()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.deleteSelection()) e.preventDefault()
    } else if (!mod && (e.key === 'h' || e.key === 'H')) {
      // H: dim the selection (push it back). Shift+H: restore all dimmed nodes.
      if (e.shiftKey ? this.clearDimmed() : this.dimSelection()) e.preventDefault()
    }
  }

  constructor (
    private canvas: HTMLCanvasElement,
    private app: AppState,
    private handlers: RendererHandlers
  ) {
    this.ctx = canvas.getContext('2d')!
    this.bindEvents()

    this.layout = createLayout(this.layoutKind, {
      onTick: () => this.requestDraw(),
      onEnd: () => {
        if (this.fitAfterSettle) {
          this.fitAfterSettle = false
          this.fit()
        }
      },
    })

    this.unsubs.push(this.app.on('graph', () => this.syncFromEngine(true)))
    this.unsubs.push(this.app.on('grammar', () => this.syncFromEngine(true)))
    this.unsubs.push(this.app.on('selectRule', () => this.updateMatchPreview()))
    this.unsubs.push(this.app.on('rules', () => this.updateMatchPreview()))
    this.unsubs.push(this.app.on('recenter', () => this.recenter()))
    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('keydown', this.onKeyDown)
    this.syncFromEngine(true)
  }

  destroy () {
    for (const u of this.unsubs) u()
    this.unsubs = []
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('keydown', this.onKeyDown)
    this.layout.destroy()
    cancelAnimationFrame(this.raf)
  }

  // ----------------------------------------------------------- layout engine
  getLayoutKind (): LayoutKind {
    return this.layoutKind
  }

  setLayout (kind: LayoutKind) {
    if (kind === this.layoutKind) return
    this.layout.destroy()
    this.layoutKind = kind
    this.layout = createLayout(kind, {
      onTick: () => this.requestDraw(),
      onEnd: () => {
        if (this.fitAfterSettle) {
          this.fitAfterSettle = false
          this.fit()
        }
      },
    })
    this.layout.setGraph(this.nodes, this.links)
    this.fitAfterSettle = true // re-frame once the new layout settles
    this.layout.run(true)
    this.requestDraw()
  }

  // ------------------------------------------------------- public API (React)
  setBrush (s: string) {
    this.brush = s
  }

  getBrush () {
    return this.brush
  }

  setMode (m: GraphMode) {
    if (this.mode === m) return
    this.mode = m
    if (m !== 'addEdge') this.edgeFrom = null
    this.handlers.onModeChange(m)
    this.requestDraw()
  }

  getMode () {
    return this.mode
  }

  setShowLabels (v: boolean) {
    this.showLabels = v
    this.requestDraw()
  }

  getShowLabels () {
    return this.showLabels
  }

  /** Replace the set of switched-off edge labels. */
  setHiddenEdgeLabels (labels: Iterable<string>) {
    this.hiddenEdgeLabels = new Set(labels)
    this.applyFilterChange()
  }

  /** Replace the set of switched-off node labels (also hides their edges). */
  setHiddenNodeLabels (labels: Iterable<string>) {
    this.hiddenNodeLabels = new Set(labels)
    this.applyFilterChange()
  }

  getHiddenEdgeLabels (): Set<string> {
    return new Set(this.hiddenEdgeLabels)
  }

  getHiddenNodeLabels (): Set<string> {
    return new Set(this.hiddenNodeLabels)
  }

  /** When on, hidden nodes/edges are removed from the force layout so the graph
   *  re-spreads around what remains. When off, hiding is display-only. */
  setRespread (v: boolean) {
    if (this.respread === v) return
    this.respread = v
    this.syncFromEngine(false) // rebuild the layout set for the new mode
    this.layout.run(true) // re-settle either way (drop hidden, or fold them back in)
    this.fitAfterSettle = true
  }

  getRespread () {
    return this.respread
  }

  /** Drop any selection that just became hidden, then either re-settle the layout
   *  (respread) or simply repaint (display-only filter). */
  private applyFilterChange () {
    this.clearHiddenSelection()
    if (this.respread) {
      this.syncFromEngine(false)
      this.layout.run(true)
    } else {
      this.requestDraw()
    }
  }

  /** Clear the node/edge selection if it points at a now-hidden element, so the
   *  inspector doesn't dangle on something invisible. */
  private clearHiddenSelection () {
    const idx = this.app.engine.index
    if (this.selectedId) {
      const n = idx.nodes.get(this.selectedId)
      if (n && this.hiddenNodeLabels.has(n.label)) this.select(null)
    }
    if (this.selectedEdgeId) {
      const e = idx.edges.get(this.selectedEdgeId)
      if (e && this.isEdgeLabelOrEndpointHidden(e)) {
        this.selectedEdgeId = null
        this.handlers.onSelectEdge(null)
      }
    }
  }

  private isNodeLabelHidden (label: string): boolean {
    return this.hiddenNodeLabels.has(label)
  }

  /** An edge is hidden by its own label or by either endpoint's label. */
  private isEdgeLabelOrEndpointHidden (e: GEdge): boolean {
    if (this.hiddenEdgeLabels.has(e.label)) return true
    const idx = this.app.engine.index
    const s = idx.nodes.get(e.source)
    const t = idx.nodes.get(e.target)
    return !!((s && this.isNodeLabelHidden(s.label)) || (t && this.isNodeLabelHidden(t.label)))
  }

  private isLinkHidden (l: Link): boolean {
    return this.hiddenEdgeLabels.has(l.edge.label) ||
      this.isNodeLabelHidden(l.source.label) ||
      this.isNodeLabelHidden(l.target.label)
  }

  /** Distinct node / edge labels in the host graph with counts, for the filter
   *  UI. Sorted by descending count, then label. */
  nodeLabelCounts (): Array<{ label: string; count: number }> {
    return this.labelCounts(this.app.engine.graph.nodes)
  }

  edgeLabelCounts (): Array<{ label: string; count: number }> {
    return this.labelCounts(this.app.engine.graph.edges)
  }

  private labelCounts (items: Array<{ label: string }>): Array<{ label: string; count: number }> {
    const counts = new Map<string, number>()
    for (const it of items) counts.set(it.label, (counts.get(it.label) ?? 0) + 1)
    return [...counts]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }

  setPreview (v: boolean) {
    this.previewOn = v
    this.updateMatchPreview()
  }

  getPreview () {
    return this.previewOn
  }

  setReheatOnEdgeChange (v: boolean) {
    this.reheatOnEdgeChange = v
  }

  getReheatOnEdgeChange () {
    return this.reheatOnEdgeChange
  }

  /** Re-read the host graph and redraw, without reheating the layout. */
  refresh () {
    this.syncFromEngine(false)
  }

  reheat () {
    this.layout.reheat()
  }

  selectNode (node: GNode | null) {
    this.selectedId = node?.id ?? null
    this.requestDraw()
  }

  relabelNode (node: GNode, label: string) {
    this.app.engine.index.relabelNode(node.id, label)
    this.requestDraw()
    this.app.commitGraph('Rename node')
  }

  deleteNode (node: GNode) {
    this.app.engine.index.removeNode(node.id)
    this.selectedIds.delete(node.id)
    if (this.selectedId === node.id) this.selectedId = null
    this.handlers.onSelect(null)
    this.app.commitGraph('Delete node')
  }

  // ---- edge editing (called from the React edge inspector / context menu) ----
  relabelEdge (edge: GEdge, label: string) {
    edge.label = label
    this.requestDraw()
    this.app.commitGraph('Set edge label') // labels affect matching → refresh preview/badges
  }

  setEdgeDirected (edge: GEdge, directed: boolean) {
    edge.directed = directed
    this.requestDraw()
    this.app.commitGraph('Set edge direction')
  }

  deleteEdge (edge: GEdge) {
    this.app.engine.index.removeEdge(edge.id)
    if (this.selectedEdgeId === edge.id) this.selectedEdgeId = null
    this.handlers.onSelectEdge(null)
    this.app.commitGraph('Delete edge')
  }

  pinToggle (node: LayoutNode) {
    if (node.fx != null) {
      node.fx = null
      node.fy = null
    } else {
      node.fx = node.x
      node.fy = node.y
    }
    this.layout.wake()
  }

  startEdgeFrom (node: GNode) {
    this.edgeFrom = node
    this.setMode('addEdge')
  }

  addNodeAt (graphX: number, graphY: number, label: string) {
    const wasEmpty = this.nodes.length === 0
    const n = makeNode(label || 'A', {}, graphX, graphY)
    this.app.engine.index.addNode(n)
    if (wasEmpty) this.fitAfterSettle = true
    this.app.commitGraph('Add node') // → syncFromEngine re-runs the layout
  }

  /** Property edits don't change topology — just redraw and refresh stats. */
  notifyPropsChanged () {
    this.requestDraw()
    this.app.commitGraph('Edit properties')
  }

  // ------------------------------------------------------------- sim sync
  private syncFromEngine (reheat: boolean) {
    const g = this.app.engine.graph
    // `known` persists across syncs and holds *every* node (hidden or not) so a
    // node filtered out of the layout in respread mode keeps its position for when
    // it folds back in.
    const seen = new Set<string>()
    let structural = false
    const fullNodes: LayoutNode[] = []
    for (const n of g.nodes) {
      seen.add(n.id)
      let ln = this.known.get(n.id)
      if (ln) {
        ln.label = n.label
        ln.props = n.props
      } else {
        structural = true
        ln = n as LayoutNode
        if (ln.x == null) ln.x = (Math.random() - 0.5) * 200
        if (ln.y == null) ln.y = (Math.random() - 0.5) * 200
        this.known.set(n.id, ln)
      }
      fullNodes.push(ln)
    }
    if (this.known.size !== seen.size) { // some nodes were removed
      for (const id of [...this.known.keys()]) if (!seen.has(id)) this.known.delete(id)
      structural = true
    }

    const fullLinks: Link[] = []
    for (const e of g.edges) {
      const s = this.known.get(e.source)
      const t = this.known.get(e.target)
      if (s && t) fullLinks.push({ source: s, target: t, edge: e })
    }

    // Edges forming/breaking is a topology change too: rules that conserve the
    // node set but rewire bonds (e.g. the chemistry grammars) still alter the
    // spring graph. When enabled, treat an edge-set change as structural so the
    // sim re-settles. We always refresh prevEdgeIds (even with the flag off) so
    // toggling it back on later compares against the latest sync, not a stale set.
    let edgesChanged = g.edges.length !== this.prevEdgeIds.size
    if (!edgesChanged) for (const e of g.edges) if (!this.prevEdgeIds.has(e.id)) { edgesChanged = true; break }
    this.prevEdgeIds = new Set(g.edges.map((e) => e.id))
    if (this.reheatOnEdgeChange && edgesChanged) structural = true

    // In respread mode the layout only sees the visible subgraph, so hiding a
    // label re-settles the rest. Otherwise hiding is display-only (everything
    // stays in the sim) and the draw loop just skips the hidden elements.
    if (this.respread) {
      this.nodes = fullNodes.filter((n) => !this.isNodeLabelHidden(n.label))
      this.links = fullLinks.filter((l) => !this.isLinkHidden(l))
    } else {
      this.nodes = fullNodes
      this.links = fullLinks
    }

    this.assignParallelOffsets()
    this.layout.setGraph(this.nodes, this.links)
    // (Re)run when the node OR edge set actually changed — pure label/prop edits
    // (same nodes, same edges) still don't re-lay-out the whole graph.
    if (reheat && structural) this.layout.run(true)
    if (this.app.lastHighlight) this.highlightTTL = 60
    this.updateMatchPreview()
    this.requestDraw()
  }

  /**
   * Fan out parallel edges. Edges sharing the same (undirected) node pair are
   * bundled and each given a signed perpendicular `off` so they render as
   * separated curves instead of overlapping straight lines — making a multigraph
   * (two or more edges between the same pair) legible. A lone edge stays straight
   * (off = 0). Ordering within a bundle is by edge id so curves are stable across
   * redraws regardless of map iteration order; the offset is measured in a
   * canonical (low-id → high-id) frame so opposite-direction edges still fan to
   * consistent sides. Self-loops (source === target) are left straight.
   */
  private assignParallelOffsets () {
    const PARALLEL_GAP = 16 // graph-unit spacing between adjacent edges in a bundle
    const groups = new Map<string, Link[]>()
    for (const l of this.links) {
      l.off = 0
      if (l.source.id === l.target.id) continue // self-loop
      const a = l.source.id; const b = l.target.id
      const key = a < b ? `${a} ${b}` : `${b} ${a}`
      let arr = groups.get(key)
      if (!arr) groups.set(key, (arr = []))
      arr.push(l)
    }
    for (const arr of groups.values()) {
      if (arr.length < 2) continue
      arr.sort((p, q) => (p.edge.id < q.edge.id ? -1 : p.edge.id > q.edge.id ? 1 : 0))
      const mid = (arr.length - 1) / 2
      for (let i = 0; i < arr.length; i++) arr[i].off = (i - mid) * PARALLEL_GAP
    }
  }

  /**
   * Geometry for a (possibly curved) link. For a bundled edge we render a
   * quadratic Bézier whose apex sits `off` units off the straight midpoint along
   * the canonical perpendicular; the control point is at 2× the apex offset.
   */
  private edgeGeom (l: Link) {
    const ax = l.source.x!; const ay = l.source.y!
    const bx = l.target.x!; const by = l.target.y!
    const off = l.off ?? 0
    const mx = (ax + bx) / 2; const my = (ay + by) / 2
    if (!off) return { ax, ay, bx, by, cx: mx, cy: my, curved: false as const }
    // Canonical orientation (low id → high id) so direction flips don't mirror
    // the side a parallel edge fans to.
    const lowFirst = l.source.id <= l.target.id
    const dx = (lowFirst ? bx - ax : ax - bx)
    const dy = (lowFirst ? by - ay : ay - by)
    const len = Math.hypot(dx, dy) || 1
    const px = -dy / len; const py = dx / len // unit perpendicular
    const cx = mx + px * off * 2
    const cy = my + py * off * 2
    return { ax, ay, bx, by, cx, cy, curved: true as const }
  }

  private updateMatchPreview () {
    this.matchedNodes.clear()
    const rule = this.app.activeRule
    if (this.previewOn && rule && rule.enabled && rule.lhs.nodes.length > 0) {
      const matches = findMatches(rule.id, rule.lhs, this.app.engine.index, { limit: 400 })
      for (const m of matches) for (const hid of Object.values(m.nodeMap)) this.matchedNodes.add(hid)
    }
    this.requestDraw()
  }

  // ------------------------------------------------------------- transform
  private screenToGraph (sx: number, sy: number) {
    return {
      x: (sx - this.transform.x) / this.transform.k,
      y: (sy - this.transform.y) / this.transform.k,
    }
  }

  private nodeAt (sx: number, sy: number): GNode | null {
    const g = this.screenToGraph(sx, sy)
    const r = 16 / this.transform.k + 6
    let best: GNode | null = null
    let bestD = r * r
    for (const n of this.nodes) {
      if (this.isNodeLabelHidden(n.label)) continue // hidden nodes aren't selectable
      const dx = (n.x ?? 0) - g.x
      const dy = (n.y ?? 0) - g.y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    return best
  }

  /** Nearest edge whose segment is within ~6px of the point, or null. */
  private edgeAt (sx: number, sy: number): GEdge | null {
    const g = this.screenToGraph(sx, sy)
    const tol = 6 / this.transform.k
    const tol2 = tol * tol
    let best: GEdge | null = null
    let bestD = tol2
    for (const l of this.links) {
      if (this.isLinkHidden(l)) continue // hidden edges aren't selectable
      const gm = this.edgeGeom(l)
      const d = gm.curved
        ? this.distToQuad2(g.x, g.y, gm)
        : this.distToSeg2(g.x, g.y, gm.ax, gm.ay, gm.bx, gm.by)
      if (d < bestD) {
        bestD = d
        best = l.edge
      }
    }
    return best
  }

  /** Squared distance from a point to a line segment. */
  private distToSeg2 (px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx
    const cy = ay + t * dy
    return (px - cx) ** 2 + (py - cy) ** 2
  }

  /** Squared distance from a point to a quadratic Bézier, by flat sampling. */
  private distToQuad2 (
    px: number,
    py: number,
    gm: { ax: number; ay: number; bx: number; by: number; cx: number; cy: number }
  ): number {
    const N = 16
    let min = Infinity
    let prevx = gm.ax; let prevy = gm.ay
    for (let i = 1; i <= N; i++) {
      const t = i / N
      const mt = 1 - t
      const x = mt * mt * gm.ax + 2 * mt * t * gm.cx + t * t * gm.bx
      const y = mt * mt * gm.ay + 2 * mt * t * gm.cy + t * t * gm.by
      const d = this.distToSeg2(px, py, prevx, prevy, x, y)
      if (d < min) min = d
      prevx = x
      prevy = y
    }
    return min
  }

  fit () {
    if (!this.nodes.length) return
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x ?? 0)
      minY = Math.min(minY, n.y ?? 0)
      maxX = Math.max(maxX, n.x ?? 0)
      maxY = Math.max(maxY, n.y ?? 0)
    }
    const pad = 60
    const w = this.canvas.clientWidth || 800
    const h = this.canvas.clientHeight || 600
    const k = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2), 2)
    this.transform.k = k
    this.transform.x = w / 2 - ((minX + maxX) / 2) * k
    this.transform.y = h / 2 - ((minY + maxY) / 2) * k
    this.requestDraw()
  }

  recenter () {
    if (this.nodes.length) {
      let cx = 0
      let cy = 0
      for (const n of this.nodes) {
        cx += n.x ?? 0
        cy += n.y ?? 0
      }
      cx /= this.nodes.length
      cy /= this.nodes.length
      if (Math.abs(cx) > 0.01 || Math.abs(cy) > 0.01) {
        for (const n of this.nodes) {
          if (n.x != null) n.x -= cx
          if (n.y != null) n.y -= cy
          if (n.fx != null) n.fx -= cx
          if (n.fy != null) n.fy -= cy
        }
      }
    }
    this.fit()
    this.fitAfterSettle = true
  }

  // ------------------------------------------------------------- events
  private bindEvents () {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => this.onDown(e))
    c.addEventListener('pointermove', (e) => this.onMove(e))
    c.addEventListener('pointerup', (e) => this.onUp(e))
    c.addEventListener('dblclick', (e) => this.onDblClick(e))
    c.addEventListener('contextmenu', (e) => this.onContext(e))
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.fitAfterSettle = false
        const rect = c.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const factor = Math.pow(1.0015, -e.deltaY)
        const gx = (sx - this.transform.x) / this.transform.k
        const gy = (sy - this.transform.y) / this.transform.k
        this.transform.k = Math.max(0.05, Math.min(8, this.transform.k * factor))
        this.transform.x = sx - gx * this.transform.k
        this.transform.y = sy - gy * this.transform.k
        this.requestDraw()
      },
      { passive: false }
    )
  }

  private localXY (e: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }

  /** Set the node multi-selection; fires onSelect with the node iff exactly one. */
  private setSelection (ids: string[]) {
    this.selectedIds = new Set(ids)
    this.selectedEdgeId = null
    const one = ids.length === 1 ? ids[0] : null
    this.selectedId = one
    this.handlers.onSelect(one ? this.app.engine.index.nodes.get(one) ?? null : null)
    this.handlers.onSelectEdge(null)
    this.requestDraw()
  }

  /** Select a single node (or clear). */
  private select (n: GNode | null) {
    this.setSelection(n ? [n.id] : [])
  }

  private toggleInSelection (n: GNode) {
    const next = new Set(this.selectedIds)
    if (next.has(n.id)) next.delete(n.id)
    else next.add(n.id)
    this.setSelection([...next])
  }

  selectAll () {
    this.setSelection(this.nodes.map((n) => n.id))
  }

  /** Select an edge; clears any node selection. */
  private selectEdge (edge: GEdge | null) {
    this.selectedIds.clear()
    this.selectedEdgeId = edge?.id ?? null
    this.selectedId = null
    this.handlers.onSelect(null)
    this.handlers.onSelectEdge(edge)
    this.requestDraw()
  }

  // -------- copy / paste / bulk delete (called from keyboard & context menu) --
  selectionCount (): number {
    return this.selectedIds.size
  }

  copySelection (): boolean {
    if (this.selectedIds.size === 0) return false
    const idx = this.app.engine.index
    const nodes = [...this.selectedIds].map((id) => idx.nodes.get(id)).filter(Boolean) as GNode[]
    if (!nodes.length) return false
    let cx = 0; let cy = 0
    for (const n of nodes) {
      cx += n.x ?? 0
      cy += n.y ?? 0
    }
    cx /= nodes.length
    cy /= nodes.length
    const sel = new Set(this.selectedIds)
    const edges: { source: string; target: string; label: string; directed: boolean }[] = []
    for (const e of idx.edges.values()) {
      if (sel.has(e.source) && sel.has(e.target)) edges.push({ source: e.source, target: e.target, label: e.label, directed: e.directed })
    }
    setClip({
      kind: 'graph',
      nodes: nodes.map((n) => ({ id: n.id, label: n.label, props: { ...n.props }, dx: (n.x ?? 0) - cx, dy: (n.y ?? 0) - cy })),
      edges,
    })
    flash(`Copied ${nodes.length} node${nodes.length === 1 ? '' : 's'}`)
    return true
  }

  paste (at?: { x: number; y: number }) {
    const c = getClip()
    if (!c || !c.nodes.length) return
    const idx = this.app.engine.index
    let tx: number, ty: number
    if (at) {
      tx = at.x
      ty = at.y
    } else if (this.hoverPoint) {
      const g = this.screenToGraph(this.hoverPoint.x, this.hoverPoint.y)
      tx = g.x
      ty = g.y
    } else {
      tx = 40
      ty = 40
    }
    const idMap = new Map<string, string>()
    const newIds: string[] = []
    for (const cn of c.nodes) {
      const n = makeNode(cn.label, { ...cn.props }, tx + cn.dx, ty + cn.dy)
      idx.addNode(n)
      idMap.set(cn.id, n.id)
      newIds.push(n.id)
    }
    for (const ce of c.edges) {
      const s = idMap.get(ce.source)
      const t = idMap.get(ce.target)
      if (s && t) idx.addEdge(makeEdge(s, t, ce.label, ce.directed))
    }
    this.app.commitGraph('Paste') // → syncFromEngine re-runs the layout
    this.setSelection(newIds)
    flash(`Pasted ${newIds.length} node${newIds.length === 1 ? '' : 's'}`)
  }

  deleteSelection (): boolean {
    const idx = this.app.engine.index
    if (this.selectedIds.size > 0) {
      const n = this.selectedIds.size
      for (const id of this.selectedIds) idx.removeNode(id)
      this.selectedIds.clear()
      this.selectedId = null
      this.handlers.onSelect(null)
      this.app.commitGraph(n > 1 ? `Delete ${n} nodes` : 'Delete node')
      return true
    }
    if (this.selectedEdgeId) {
      const edge = idx.edges.get(this.selectedEdgeId)
      if (edge) {
        this.deleteEdge(edge)
        return true
      }
    }
    return false
  }

  // -------- dim / focus (visualisation aid; does not alter the graph) --------
  dimmedCount (): number {
    return this.dimmedIds.size
  }

  hasDimmed (): boolean {
    return this.dimmedIds.size > 0
  }

  /** Push the current node selection into the background (low opacity). Clears
   *  the selection afterwards so the dimmed nodes lose their selection ring and
   *  fully recede. Returns false if nothing was selected. */
  dimSelection (): boolean {
    if (this.selectedIds.size === 0) return false
    for (const id of this.selectedIds) this.dimmedIds.add(id)
    const n = this.selectedIds.size
    this.select(null)
    flash(`Dimmed ${n} node${n === 1 ? '' : 's'} · Show all to restore`)
    this.requestDraw()
    return true
  }

  /** The inverse: dim everything EXCEPT the current selection, so the selected
   *  nodes stand out. Clears the selection afterwards. */
  focusSelection (): boolean {
    if (this.selectedIds.size === 0) return false
    this.dimmedIds.clear()
    for (const n of this.nodes) if (!this.selectedIds.has(n.id)) this.dimmedIds.add(n.id)
    const kept = this.selectedIds.size
    this.select(null)
    flash(`Focused ${kept} node${kept === 1 ? '' : 's'} · Show all to restore`)
    this.requestDraw()
    return true
  }

  /** Restore every dimmed node to full opacity. */
  clearDimmed (): boolean {
    if (this.dimmedIds.size === 0) return false
    this.dimmedIds.clear()
    this.requestDraw()
    return true
  }

  private onDown (e: PointerEvent) {
    if (e.button !== 0) return
    this.fitAfterSettle = false
    this.canvas.setPointerCapture(e.pointerId)
    const { sx, sy } = this.localXY(e)
    const node = this.nodeAt(sx, sy)
    if (node) {
      if (this.mode === 'addEdge' || e.shiftKey) {
        this.edgeFrom = node
      } else if (e.ctrlKey || e.metaKey) {
        this.toggleInSelection(node) // add/remove from multi-selection
        return
      } else {
        if (!this.selectedIds.has(node.id)) this.select(node)
        this.dragNode = node
        this.layout.dragStart(node)
      }
      return
    }
    // empty space + Shift → rubber-band marquee selection
    if (e.shiftKey) {
      this.marquee = { x0: sx, y0: sy, x1: sx, y1: sy }
      return
    }
    // otherwise try an edge (thin hit target), then fall back to panning
    const edge = this.edgeAt(sx, sy)
    if (edge) this.selectEdge(edge)
    else this.select(null)
    this.panning = true
    this.panStart = { x: sx, y: sy, tx: this.transform.x, ty: this.transform.y }
  }

  private onMove (e: PointerEvent) {
    const { sx, sy } = this.localXY(e)
    const g = this.screenToGraph(sx, sy)
    this.hoverPoint = { x: sx, y: sy }
    if (this.marquee) {
      this.marquee.x1 = sx
      this.marquee.y1 = sy
      this.requestDraw()
      return
    }
    if (this.dragNode) {
      this.layout.dragMove(this.dragNode, g.x, g.y)
      this.requestDraw()
    } else if (this.edgeFrom) {
      this.requestDraw()
    } else if (this.panning) {
      this.transform.x = this.panStart.tx + (sx - this.panStart.x)
      this.transform.y = this.panStart.ty + (sy - this.panStart.y)
      this.requestDraw()
    }
  }

  private onUp (e: PointerEvent) {
    const { sx, sy } = this.localXY(e)
    try {
      this.canvas.releasePointerCapture(e.pointerId)
    } catch {}
    if (this.marquee) {
      const m = this.marquee
      this.marquee = null
      const a = this.screenToGraph(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1))
      const b = this.screenToGraph(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1))
      const ids = this.nodes
        .filter((n) => (n.x ?? 0) >= a.x && (n.x ?? 0) <= b.x && (n.y ?? 0) >= a.y && (n.y ?? 0) <= b.y)
        .map((n) => n.id)
      if (e.ctrlKey || e.metaKey) for (const id of this.selectedIds) ids.push(id) // additive
      this.setSelection([...new Set(ids)])
      return
    }
    if (this.dragNode) {
      this.layout.dragEnd(this.dragNode, e.shiftKey) // Shift = keep pinned
      this.dragNode = null
    } else if (this.edgeFrom) {
      const target = this.nodeAt(sx, sy)
      if (target && target !== this.edgeFrom) {
        // drop on a node → connect the two
        this.app.engine.index.addEdge(makeEdge(this.edgeFrom.id, target.id, '', true))
        this.app.commitGraph('Connect')
      } else if (!target) {
        // drop on empty → spawn a new node there and connect it (shorthand)
        const g = this.screenToGraph(sx, sy)
        const n = makeNode(this.brush || 'A', {}, g.x, g.y)
        this.app.engine.index.addNode(n)
        this.app.engine.index.addEdge(makeEdge(this.edgeFrom.id, n.id, '', true))
        this.app.commitGraph('Add & connect node') // → syncFromEngine re-runs the layout
      }
      this.edgeFrom = null
      this.requestDraw()
    }
    this.panning = false
  }

  private onDblClick (e: MouseEvent) {
    e.preventDefault()
    const { sx, sy } = this.localXY(e)
    const existing = this.nodeAt(sx, sy)
    if (existing) {
      const next = prompt('Node label:', existing.label)
      if (next != null) this.relabelNode(existing, next)
      return
    }
    const g = this.screenToGraph(sx, sy)
    this.addNodeAt(g.x, g.y, this.brush)
  }

  private onContext (e: MouseEvent) {
    e.preventDefault()
    const { sx, sy } = this.localXY(e)
    const node = this.nodeAt(sx, sy)
    const edge = node ? null : this.edgeAt(sx, sy)
    // Keep an existing multi-selection if the right-clicked node is part of it
    // (so "Dim/Copy/Delete N nodes" act on the whole group); otherwise select it.
    if (node) {
      if (!this.selectedIds.has(node.id)) this.select(node)
    } else if (edge) this.selectEdge(edge)
    const g = this.screenToGraph(sx, sy)
    this.handlers.onContextMenu({ clientX: e.clientX, clientY: e.clientY, node, edge, graphX: g.x, graphY: g.y })
  }

  // ------------------------------------------------------------- rendering
  private requestDraw () {
    if (this.scheduled) return
    this.scheduled = true
    this.raf = requestAnimationFrame(() => this.frame())
  }

  private frame () {
    this.scheduled = false
    this.draw()
    if (this.highlightTTL > 0) {
      this.highlightTTL--
      this.requestDraw()
    }
  }

  resize () {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr))
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr))
    this.draw()
  }

  private draw () {
    const ctx = this.ctx
    if (this.canvas.width === 0) this.resize()
    ctx.save()
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.scale(this.dpr, this.dpr)
    ctx.translate(this.transform.x, this.transform.y)
    ctx.scale(this.transform.k, this.transform.k)

    const hl = this.app.lastHighlight
    const highlightOn = this.highlightTTL > 0 && hl

    ctx.lineWidth = 1.2 / this.transform.k
    const showEdgeLabels = this.showLabels && this.transform.k > 0.8
    const anyDimmed = this.dimmedIds.size > 0
    for (const l of this.links) {
      if (this.isLinkHidden(l)) continue // switched off in the filter (own label or an endpoint's)
      // An edge fades when either endpoint is dimmed, so it recedes with them.
      ctx.globalAlpha = anyDimmed && (this.dimmedIds.has(l.source.id) || this.dimmedIds.has(l.target.id)) ? DIM_EDGE : 1
      const created = highlightOn && hl!.created.has(l.edge.id)
      const sel = l.edge.id === this.selectedEdgeId
      ctx.strokeStyle = sel ? '#7b5dcd' : created ? '#4beb8f' : 'rgba(150,160,175,0.55)'
      ctx.lineWidth = (sel ? 3 : created ? 2.4 : 1.2) / this.transform.k
      const gm = this.edgeGeom(l)
      ctx.beginPath()
      ctx.moveTo(gm.ax, gm.ay)
      if (gm.curved) ctx.quadraticCurveTo(gm.cx, gm.cy, gm.bx, gm.by)
      else ctx.lineTo(gm.bx, gm.by)
      ctx.stroke()
      if (l.edge.directed) this.drawArrow(ctx, gm)
      if (showEdgeLabels && l.edge.label) {
        // apex of the quadratic (t=0.5): 0.25·A + 0.5·C + 0.25·B (= midpoint when straight)
        const lx = gm.curved ? (gm.ax + 2 * gm.cx + gm.bx) / 4 : (gm.ax + gm.bx) / 2
        const ly = gm.curved ? (gm.ay + 2 * gm.cy + gm.by) / 4 : (gm.ay + gm.by) / 2
        ctx.fillStyle = 'rgba(190,198,210,0.9)'
        ctx.font = `${10 / this.transform.k}px ui-sans-serif, system-ui`
        ctx.textAlign = 'center'
        ctx.fillText(l.edge.label, lx, ly - 3 / this.transform.k)
      }
    }

    ctx.globalAlpha = 1 // reset after any dimmed edges

    if (this.edgeFrom && this.hoverPoint) {
      const g = this.screenToGraph(this.hoverPoint.x, this.hoverPoint.y)
      ctx.strokeStyle = '#7b5dcd'
      ctx.setLineDash([6 / this.transform.k, 4 / this.transform.k])
      ctx.beginPath()
      ctx.moveTo(this.edgeFrom.x!, this.edgeFrom.y!)
      ctx.lineTo(g.x, g.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    const drawText = this.showLabels && this.transform.k > 0.55
    const showMatch = this.previewOn && this.matchedNodes.size > 0
    const resolve = this.app.nodeStyle
    for (const n of this.nodes) {
      if (this.isNodeLabelHidden(n.label)) continue // switched off in the filter
      const st = resolveNodeStyle(n, resolve)
      const radius = st.radius ?? 11
      const created = highlightOn && hl!.created.has(n.id)
      const selected = this.selectedIds.has(n.id)
      const dimmed = anyDimmed && this.dimmedIds.has(n.id)
      const k = this.transform.k
      const x = n.x!; const y = n.y!

      // match-preview halo (kept at full opacity so it stays legible) — but not
      // on a dimmed node, which should stay quietly in the background.
      if (showMatch && this.matchedNodes.has(n.id) && !dimmed) {
        ctx.beginPath()
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(245,159,0,0.28)'
        ctx.fill()
        ctx.lineWidth = 2 / k
        ctx.strokeStyle = '#f59f00'
        ctx.stroke()
      }

      ctx.globalAlpha = st.opacity * (dimmed ? DIM_NODE : 1)

      // optional status ring just outside the node
      if (st.ring) {
        traceNodeShape(ctx, st.shape, x, y, radius + 3.5)
        ctx.lineWidth = 2.5 / k
        ctx.strokeStyle = st.ring
        ctx.stroke()
      }

      // body
      traceNodeShape(ctx, st.shape, x, y, radius)
      ctx.fillStyle = st.fill
      ctx.fill()
      ctx.lineWidth = (selected ? 3 : created ? 3 : st.strokeWidth ?? 1.5) / k
      ctx.strokeStyle = selected ? '#ffffff' : created ? '#4beb8f' : st.stroke
      ctx.stroke()

      // glyph (takes precedence) or label text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = st.textColor
      if (st.glyph) {
        ctx.font = `${Math.round(radius * 1.25)}px ui-sans-serif, system-ui`
        ctx.fillText(st.glyph, x, y)
      } else if (drawText && st.text !== null) {
        const txt = st.text !== undefined ? st.text : n.label.length > 4 ? n.label.slice(0, 4) : n.label
        ctx.font = '10px ui-sans-serif, system-ui'
        ctx.fillText(txt, x, y)
      }
      ctx.globalAlpha = 1
    }
    ctx.restore()

    // rubber-band marquee (screen space)
    if (this.marquee) {
      ctx.save()
      ctx.scale(this.dpr, this.dpr)
      const m = this.marquee
      const x = Math.min(m.x0, m.x1)
      const y = Math.min(m.y0, m.y1)
      const w = Math.abs(m.x1 - m.x0)
      const h = Math.abs(m.y1 - m.y0)
      ctx.fillStyle = 'rgba(123,93,205,0.16)'
      ctx.strokeStyle = '#7b5dcd'
      ctx.lineWidth = 1
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
      ctx.restore()
    }
  }

  private drawArrow (
    ctx: CanvasRenderingContext2D,
    gm: { ax: number; ay: number; bx: number; by: number; cx: number; cy: number; curved: boolean }
  ) {
    // Tangent at the target end: for a quadratic that's (end − control), else the
    // straight source→target direction.
    const dx = gm.curved ? gm.bx - gm.cx : gm.bx - gm.ax
    const dy = gm.curved ? gm.by - gm.cy : gm.by - gm.ay
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const ax = gm.bx - ux * 12
    const ay = gm.by - uy * 12
    const size = 5 / this.transform.k
    ctx.fillStyle = 'rgba(150,160,175,0.7)'
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - ux * size * 2 - uy * size, ay - uy * size * 2 + ux * size)
    ctx.lineTo(ax - ux * size * 2 + uy * size, ay - uy * size * 2 - ux * size)
    ctx.closePath()
    ctx.fill()
  }

  mounted () {
    this.resize()
    this.recenter()
    this.layout.wake()
    requestAnimationFrame(() => {
      this.resize()
      this.recenter()
    })
  }
}
