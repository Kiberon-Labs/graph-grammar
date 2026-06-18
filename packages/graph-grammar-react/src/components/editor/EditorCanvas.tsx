import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { Rule, PatternNode, PatternEdge, RhsNode, RhsEdge } from 'graph-grammar'
import { uid } from 'graph-grammar'
import { labelColor, darken, textOn } from '../../colors.ts'
import { resolveNodeStyle, shapePolygonPoints } from '../../nodePaint.ts'
import { useApp } from '../../AppContext.tsx'
import { useContextMenu } from '../ContextMenu.tsx'
import { getClip, setClip, hasClip } from '../../clipboard.ts'
import { flash } from '../../toast.ts'
import {
  panelGeom,
  panelIds,
  panelLabel,
  viewSize,
  R,
  panelAt,
  distToSeg,
  syncMorphism,
  nodesOf,
  edgesOf,
  isNac,
  isPattern,
  nacIndex,
  type PanelId,
  type Sel,
} from './model.ts'

interface Props {
  rule: Rule;
  sel: Sel;
  setSel: (s: Sel) => void;
  brush: string;
  newEdgeDirected: boolean;
  commit: () => void;
  onDelete: () => void;
}

type Drag =
  | { mode: 'move'; panel: PanelId; id: string; ox: number; oy: number }
  | { mode: 'connect'; panel: PanelId; from: string; x: number; y: number }
  | { mode: 'pan'; startVBx: number; startVBy: number; vx: number; vy: number }
  | null

interface View {
  k: number;
  x: number;
  y: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * The authoring surface, rendered as a declarative SVG: the LHS match pattern,
 * the RHS result, and one panel per NAC (negative application condition) in a
 * row below. Connections are drawn by dragging a node's port; a line across the
 * LHS/RHS gutter is the morphism. NAC panels are pattern panels like the LHS but
 * never map , the engine matches each independently and blocks the rule if found.
 */
export function EditorCanvas ({ rule, sel, setSel, brush, newEdgeDirected, commit, onDelete }: Props) {
  const app = useApp()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag>(null)
  const [, redraw] = useState(0)
  const menu = useContextMenu()

  const vs = viewSize(rule)

  // pan/zoom: `view` translates+scales the content group; viewRef gives pointer
  // handlers a stale-free read of the current transform.
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 })
  const viewRef = useRef(view)
  viewRef.current = view

  // multi-selection of nodes within one panel (copy / paste / bulk delete)
  const [multi, setMulti] = useState<{ panel: PanelId; ids: Set<string> } | null>(null)
  const multiRef = useRef(multi)
  multiRef.current = multi
  // marquee is a ref (read synchronously in pointer handlers); `redraw` re-renders.
  const marquee = useRef<{ panel: PanelId; x0: number; y0: number; x1: number; y1: number } | null>(null)
  const lastLocal = useRef({ x: 520, y: 270 })

  const applyMulti = (panel: PanelId, ids: Set<string>) => {
    setMulti(ids.size ? { panel, ids } : null)
    if (ids.size === 1) setSel({ kind: 'node', panel, id: [...ids][0] })
    else setSel(null)
  }

  // ---- copy / paste / bulk delete (operate on the multi-selection) ----
  const copySel = (): boolean => {
    const m = multiRef.current
    if (!m || m.ids.size === 0) return false
    const g = panelGeom(m.panel)
    const arr = nodesOf(rule, m.panel)
    const nodes = [...m.ids].map((id) => arr.find((n) => n.id === id)).filter(Boolean) as (PatternNode | RhsNode)[]
    if (!nodes.length) return false
    let cx = 0
    let cy = 0
    for (const n of nodes) {
      cx += g.x0 + (n.x ?? 0)
      cy += g.y0 + (n.y ?? 0)
    }
    cx /= nodes.length
    cy /= nodes.length
    const sel = m.ids
    const edges = edgesOf(rule, m.panel).filter((e) => sel.has(e.source) && sel.has(e.target))
    setClip({
      // NAC nodes share the LHS pattern shape; store them under "lhs" so the
      // narrow clip kind stays valid (paste targets the panel under the cursor).
      kind: isNac(m.panel) ? 'lhs' : m.panel,
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        props: { ...n.props },
        dx: g.x0 + (n.x ?? 0) - cx,
        dy: g.y0 + (n.y ?? 0) - cy,
        extra: structuredClone(n),
      })),
      edges: edges.map((e) => ({ source: e.source, target: e.target, label: e.label, directed: e.directed })),
    })
    flash(`Copied ${nodes.length} node${nodes.length === 1 ? '' : 's'}`)
    return true
  }

  const paste = () => {
    const c = getClip()
    if (!c || !c.nodes.length) return
    const panel = panelAt(rule, lastLocal.current.x, lastLocal.current.y) ?? (c.kind === 'rhs' ? 'rhs' : 'lhs')
    const g = panelGeom(panel)
    const arr = nodesOf(rule, panel)
    const edges = edgesOf(rule, panel)
    const tx = lastLocal.current.x
    const ty = lastLocal.current.y
    const idMap = new Map<string, string>()
    const newIds = new Set<string>()
    for (const cn of c.nodes) {
      const id = uid(panel === 'rhs' ? 'r' : 'l')
      const x = clamp(tx + cn.dx - g.x0, R, g.w - R)
      const y = clamp(ty + cn.dy - g.y0, R, g.h - R)
      const base: any = cn.extra ? structuredClone(cn.extra) : { label: cn.label, props: { ...cn.props } }
      base.id = id
      base.x = x
      base.y = y
      if (panel === 'rhs') base.mapFrom = null // pasted RHS nodes are fresh (not preserving an LHS node)
      else delete base.mapFrom // pattern panels (LHS / NAC) have no mapping
      arr.push(base)
      idMap.set(cn.id, id)
      newIds.add(id)
    }
    for (const ce of c.edges) {
      const s = idMap.get(ce.source)
      const t = idMap.get(ce.target)
      if (s && t) edges.push({ id: uid('e'), source: s, target: t, label: ce.label, directed: ce.directed, props: {} } as PatternEdge | RhsEdge)
    }
    applyMulti(panel, newIds)
    commit()
    flash(`Pasted ${newIds.size} node${newIds.size === 1 ? '' : 's'}`)
  }

  const deleteMulti = () => {
    const m = multiRef.current
    if (!m || m.ids.size === 0) return
    const arr = nodesOf(rule, m.panel)
    const edges = edgesOf(rule, m.panel)
    for (const id of m.ids) {
      const i = arr.findIndex((n) => n.id === id)
      if (i >= 0) arr.splice(i, 1)
      for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === id || edges[k].target === id) edges.splice(k, 1)
      if (m.panel === 'lhs') for (const rn of rule.rhs.nodes) if (rn.mapFrom === id) rn.mapFrom = null
    }
    syncMorphism(rule)
    setMulti(null)
    setSel(null)
    commit()
  }

  const selectAllInPanel = () => {
    const panel = panelAt(rule, lastLocal.current.x, lastLocal.current.y) ?? multiRef.current?.panel ?? 'lhs'
    applyMulti(panel, new Set(nodesOf(rule, panel).map((n) => n.id)))
  }

  /** Add a NAC (empty forbidden pattern) and frame it. */
  const addNac = () => {
    rule.nac = rule.nac ?? []
    rule.nac.push({ nodes: [], edges: [] })
    commit()
  }
  /** Remove the NAC behind a panel id, clearing any selection into it. */
  const deleteNac = (panel: PanelId) => {
    if (!isNac(panel) || !rule.nac) return
    rule.nac.splice(nacIndex(panel), 1)
    if (rule.nac.length === 0) delete rule.nac
    setSel(null)
    setMulti(null)
    commit()
  }

  // client px → viewBox coords (outer SVG only, before the content transform)
  const clientToViewBox = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const pt = svgRef.current!.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const zoomBy = (factor: number) => {
    const v = viewRef.current
    const cx = vs.w / 2
    const cy = vs.h / 2
    const innerX = (cx - v.x) / v.k
    const innerY = (cy - v.y) / v.k
    const k = clamp(v.k * factor, 0.25, 4)
    setView({ k, x: cx - innerX * k, y: cy - innerY * k })
  }

  // wheel zoom (native listener so we can preventDefault page scroll)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const vb = clientToViewBox(e.clientX, e.clientY)
      const v = viewRef.current
      const innerX = (vb.x - v.x) / v.k
      const innerY = (vb.y - v.y) / v.k
      const k = clamp(v.k * Math.pow(1.0015, -e.deltaY), 0.25, 4)
      setView({ k, x: vb.x - innerX * k, y: vb.y - innerY * k })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const nodeById = (p: PanelId, id: string) => nodesOf(rule, p).find((n) => n.id === id)
  const nodeCenter = (p: PanelId, id: string) => {
    const n = nodeById(p, id)
    const g = panelGeom(p)
    return n ? { x: g.x0 + (n.x ?? 0), y: g.y0 + (n.y ?? 0) } : null
  }

  // client px → content coords (panel-local space, accounting for pan/zoom)
  const toLocal = (clientX: number, clientY: number) => {
    const vb = clientToViewBox(clientX, clientY)
    const v = viewRef.current
    return { x: (vb.x - v.x) / v.k, y: (vb.y - v.y) / v.k }
  }

  const nodeAtLocal = (lx: number, ly: number): { panel: PanelId; id: string } | null => {
    for (const panel of panelIds(rule)) {
      const p = panelGeom(panel)
      for (const n of nodesOf(rule, panel)) {
        const cx = p.x0 + (n.x ?? 0)
        const cy = p.y0 + (n.y ?? 0)
        if ((lx - cx) ** 2 + (ly - cy) ** 2 <= (R + 4) ** 2) return { panel, id: n.id }
      }
    }
    return null
  }
  const edgeAtLocal = (lx: number, ly: number): { panel: PanelId; id: string } | null => {
    for (const panel of panelIds(rule)) {
      for (const e of edgesOf(rule, panel)) {
        const a = nodeCenter(panel, e.source)
        const b = nodeCenter(panel, e.target)
        if (a && b && distToSeg(lx, ly, a.x, a.y, b.x, b.y) <= 100) return { panel, id: e.id }
      }
    }
    return null
  }
  const mapAtLocal = (lx: number, ly: number): string | null => {
    for (const n of rule.rhs.nodes) {
      if (!n.mapFrom) continue
      const a = nodeCenter('lhs', n.mapFrom)
      const b = nodeCenter('rhs', n.id)
      if (a && b && distToSeg(lx, ly, a.x, a.y, b.x, b.y) <= 100) return n.id
    }
    return null
  }

  // ---- mutations ----
  const createNode = (panel: PanelId, x: number, y: number): string => {
    const id = uid(panel === 'rhs' ? 'r' : isNac(panel) ? 'x' : 'l')
    const g = panelGeom(panel)
    const cx = clamp(x, R, g.w - R)
    const cy = clamp(y, R, g.h - R)
    if (panel === 'rhs') rule.rhs.nodes.push({ id, label: brush, props: {}, x: cx, y: cy, mapFrom: null })
    else (nodesOf(rule, panel) as PatternNode[]).push({ id, label: brush, props: {}, x: cx, y: cy })
    return id
  }
  const addNode = (panel: PanelId, x: number, y: number) => {
    const id = createNode(panel, x, y)
    setSel({ kind: 'node', panel, id })
    commit()
  }
  const completeConnect = (fromPanel: PanelId, fromId: string, toPanel: PanelId, toId: string) => {
    if (fromPanel === toPanel) {
      if (fromId === toId) return
      const id = uid('e')
      const edge = { id, source: fromId, target: toId, label: '', directed: newEdgeDirected, props: {} };
      (edgesOf(rule, fromPanel) as (PatternEdge | RhsEdge)[]).push(edge as PatternEdge | RhsEdge)
      setSel({ kind: 'edge', panel: fromPanel, id })
      commit()
    } else if ((fromPanel === 'lhs' && toPanel === 'rhs') || (fromPanel === 'rhs' && toPanel === 'lhs')) {
      // a cross-gutter drag between LHS and RHS authors the morphism
      const lhsId = fromPanel === 'lhs' ? fromId : toId
      const rhsId = fromPanel === 'lhs' ? toId : fromId
      const rhsNode = rule.rhs.nodes.find((n) => n.id === rhsId)
      if (rhsNode) {
        rhsNode.mapFrom = lhsId
        syncMorphism(rule)
        setSel({ kind: 'map', rhsNodeId: rhsId })
        commit()
      }
    }
    // a drag to/from a NAC panel across the gutter has no meaning , ignore.
  }

  // ---- pointer ----
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as Element
    const portEl = target.closest('[data-port]') as SVGElement | null
    const local = toLocal(e.clientX, e.clientY)
    try {
      svgRef.current!.setPointerCapture(e.pointerId)
    } catch { }
    if (portEl) {
      const panel = portEl.getAttribute('data-panel') as PanelId
      const id = portEl.getAttribute('data-port')!
      drag.current = { mode: 'connect', panel, from: id, x: local.x, y: local.y }
      setSel({ kind: 'node', panel, id })
      return
    }
    const hitNode = nodeAtLocal(local.x, local.y)
    if (hitNode) {
      const node = nodeById(hitNode.panel, hitNode.id)!
      const g = panelGeom(hitNode.panel)
      const px = g.x0 + (node.x ?? 0)
      const py = g.y0 + (node.y ?? 0)
      if (e.shiftKey) {
        drag.current = { mode: 'connect', panel: hitNode.panel, from: hitNode.id, x: local.x, y: local.y }
      } else if (e.ctrlKey || e.metaKey) {
        const cur = multiRef.current && multiRef.current.panel === hitNode.panel ? new Set(multiRef.current.ids) : new Set<string>()
        if (cur.has(hitNode.id)) cur.delete(hitNode.id)
        else cur.add(hitNode.id)
        applyMulti(hitNode.panel, cur)
      } else {
        drag.current = { mode: 'move', panel: hitNode.panel, id: hitNode.id, ox: local.x - px, oy: local.y - py }
        applyMulti(hitNode.panel, new Set([hitNode.id]))
      }
      return
    }
    const hitEdge = edgeAtLocal(local.x, local.y)
    if (hitEdge) {
      setMulti(null)
      return setSel({ kind: 'edge', panel: hitEdge.panel, id: hitEdge.id })
    }
    const hitMap = mapAtLocal(local.x, local.y)
    if (hitMap) {
      setMulti(null)
      return setSel({ kind: 'map', rhsNodeId: hitMap })
    }
    // empty space: Shift starts a marquee in that panel; otherwise pan the view
    const panel = panelAt(rule, local.x, local.y)
    if (e.shiftKey && panel) {
      marquee.current = { panel, x0: local.x, y0: local.y, x1: local.x, y1: local.y }
      redraw((x) => x + 1)
      return
    }
    setSel(null)
    setMulti(null)
    const vb = clientToViewBox(e.clientX, e.clientY)
    drag.current = { mode: 'pan', startVBx: vb.x, startVBy: vb.y, vx: viewRef.current.x, vy: viewRef.current.y }
  }

  const onMove = (e: React.PointerEvent) => {
    lastLocal.current = toLocal(e.clientX, e.clientY)
    if (marquee.current) {
      marquee.current.x1 = lastLocal.current.x
      marquee.current.y1 = lastLocal.current.y
      redraw((x) => x + 1)
      return
    }
    const d = drag.current
    if (!d) return
    if (d.mode === 'pan') {
      const vb = clientToViewBox(e.clientX, e.clientY)
      setView((v) => ({ ...v, x: d.vx + (vb.x - d.startVBx), y: d.vy + (vb.y - d.startVBy) }))
      return
    }
    const local = toLocal(e.clientX, e.clientY)
    if (d.mode === 'move') {
      const node = nodeById(d.panel, d.id)
      if (!node) return
      const p = panelGeom(d.panel)
      node.x = clamp(local.x - p.x0 - d.ox, R, p.w - R)
      node.y = clamp(local.y - p.y0 - d.oy, R, p.h - R)
      redraw((x) => x + 1)
    } else {
      d.x = local.x
      d.y = local.y
      redraw((x) => x + 1)
    }
  }

  const onUp = (e: React.PointerEvent) => {
    const local = toLocal(e.clientX, e.clientY)
    try {
      svgRef.current!.releasePointerCapture(e.pointerId)
    } catch { }
    if (marquee.current) {
      const m = marquee.current
      marquee.current = null
      redraw((x) => x + 1)
      const x0 = Math.min(m.x0, m.x1); const x1 = Math.max(m.x0, m.x1); const y0 = Math.min(m.y0, m.y1); const y1 = Math.max(m.y0, m.y1)
      const g = panelGeom(m.panel)
      const ids = new Set<string>()
      for (const n of nodesOf(rule, m.panel)) {
        const cx = g.x0 + (n.x ?? 0)
        const cy = g.y0 + (n.y ?? 0)
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) ids.add(n.id)
      }
      if ((e.ctrlKey || e.metaKey) && multiRef.current?.panel === m.panel) for (const id of multiRef.current.ids) ids.add(id)
      applyMulti(m.panel, ids)
      return
    }
    const d = drag.current
    drag.current = null
    if (d?.mode === 'connect') {
      const hit = nodeAtLocal(local.x, local.y)
      if (hit && !(hit.panel === d.panel && hit.id === d.from)) {
        completeConnect(d.panel, d.from, hit.panel, hit.id)
      } else if (!hit) {
        const panel = panelAt(rule, local.x, local.y)
        if (panel) {
          const g = panelGeom(panel)
          const newId = createNode(panel, local.x - g.x0, local.y - g.y0)
          completeConnect(d.panel, d.from, panel, newId)
        }
      }
      redraw((x) => x + 1)
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const local = toLocal(e.clientX, e.clientY)
    if (nodeAtLocal(local.x, local.y)) return
    const panel = panelAt(rule, local.x, local.y)
    if (panel) {
      const g = panelGeom(panel)
      addNode(panel, local.x - g.x0, local.y - g.y0)
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const local = toLocal(e.clientX, e.clientY)
    lastLocal.current = local
    const node = nodeAtLocal(local.x, local.y)
    if (node) {
      const m = multiRef.current
      const inMulti = !!(m && m.panel === node.panel && m.ids.has(node.id) && m.ids.size > 1)
      if (inMulti) {
        menu.open(e.clientX, e.clientY, [
          { label: `Copy ${m!.ids.size} nodes`, hint: 'Ctrl+C', action: copySel },
          ...(hasClip() ? [{ label: 'Paste here', hint: 'Ctrl+V', action: paste }] : []),
          { separator: true },
          { label: `Delete ${m!.ids.size} nodes`, danger: true, action: deleteMulti },
        ])
        return
      }
      applyMulti(node.panel, new Set([node.id]))
      menu.open(e.clientX, e.clientY, [
        { label: 'Copy node', hint: 'Ctrl+C', action: copySel },
        ...(hasClip() ? [{ label: 'Paste here', hint: 'Ctrl+V', action: paste }] : []),
        { separator: true },
        ...nodeMenu(node.panel, node.id),
      ])
      return
    }
    const edge = edgeAtLocal(local.x, local.y)
    if (edge) {
      setSel({ kind: 'edge', panel: edge.panel, id: edge.id })
      const ed = edgesOf(rule, edge.panel).find((x) => x.id === edge.id)!
      menu.open(e.clientX, e.clientY, [
        {
          label: ed.directed ? 'Make undirected' : 'Make directed →',
          action: () => {
            ed.directed = !ed.directed
            commit()
          },
        },
        {
          label: 'Flip direction (⇄)',
          disabled: !ed.directed,
          action: () => {
            const s = ed.source
            ed.source = ed.target
            ed.target = s
            commit()
          },
        },
        { label: 'Delete edge', danger: true, action: onDelete },
      ])
      return
    }
    const map = mapAtLocal(local.x, local.y)
    if (map) {
      setSel({ kind: 'map', rhsNodeId: map })
      menu.open(e.clientX, e.clientY, [{ label: 'Remove mapping', danger: true, action: onDelete }])
      return
    }
    const panel = panelAt(rule, local.x, local.y)
    if (panel) {
      menu.open(e.clientX, e.clientY, [
        {
          label: `Add “${brush}” node here`,
          action: () => {
            const g = panelGeom(panel)
            addNode(panel, local.x - g.x0, local.y - g.y0)
          },
        },
        ...(hasClip() ? [{ label: 'Paste here', hint: 'Ctrl+V', action: paste }] : []),
        ...(isNac(panel) ? [{ separator: true }, { label: `Delete ${panelLabel(panel)}`, danger: true, action: () => deleteNac(panel) }] : []),
      ])
    }
  }

  const nodeMenu = (panel: PanelId, id: string) => {
    const node = nodeById(panel, id)!
    const items: import('../ContextMenu.tsx').MenuItem[] = [
      {
        label: 'Rename…',
        hint: node.label,
        action: () => {
          const v = prompt('Node label (use * for wildcard):', node.label)
          if (v != null) {
            node.label = v
            commit()
          }
        },
      },
    ]
    if (isPattern(panel)) {
      const pn = node as PatternNode
      items.push({
        label: pn.wildcard ? '✓ Wildcard (match any)' : 'Make wildcard (match any)',
        action: () => {
          pn.wildcard = !pn.wildcard
          commit()
        },
      })
    } else {
      const rn = node as RhsNode
      if (rn.mapFrom) {
        items.push({
          label: 'Unmap (make a created node)',
          action: () => {
            rn.mapFrom = null
            syncMorphism(rule)
            commit()
          },
        })
      }
    }
    items.push({ separator: true })
    items.push({ label: 'Delete node', danger: true, action: onDelete })
    return items
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && (e.key === 'c' || e.key === 'C')) {
      if (copySel()) e.preventDefault()
    } else if (mod && (e.key === 'v' || e.key === 'V')) {
      paste()
      e.preventDefault()
    } else if (mod && (e.key === 'a' || e.key === 'A')) {
      selectAllInPanel()
      e.preventDefault()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const m = multiRef.current
      if (m && m.ids.size > 1) deleteMulti()
      else onDelete()
    }
  }

  // ---- render ----
  const d = drag.current
  const ids = panelIds(rule)
  return (
    <div className='ec-host'>
      <svg
        ref={svgRef}
        className='rule-svg'
        viewBox={`0 0 ${vs.w} ${vs.h}`}
        preserveAspectRatio='xMidYMid meet'
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        <defs>
          <marker id='arrow' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8.5' markerHeight='8.5' orient='auto-start-reverse'>
            <path d='M0,0 L10,5 L0,10 z' fill='#a8a8a8' />
          </marker>
          <marker id='arrow-sel' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='9' markerHeight='9' orient='auto-start-reverse'>
            <path d='M0,0 L10,5 L0,10 z' fill='#7b5dcd' />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {ids.map((panel) => {
            const p = panelGeom(panel)
            const nac = isNac(panel)
            return (
              <g key={'frame-' + panel}>
                <rect x={p.x0} y={p.y0} width={p.w} height={p.h} rx={12} className={nac ? 'panel-frame nac' : 'panel-frame'} />
                <text x={p.x0 + 14} y={p.y0 - 14} className={nac ? 'panel-title nac' : 'panel-title'}>
                  {p.title}
                </text>
                {nac && (
                  <g
                    className='nac-del'
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      deleteNac(panel)
                    }}
                  >
                    <title>Delete this NAC</title>
                    <circle cx={p.x0 + p.w - 16} cy={p.y0 - 18} r={10} className='nac-del-bg' />
                    <text x={p.x0 + p.w - 16} y={p.y0 - 14} textAnchor='middle' className='nac-del-x'>
                      ✕
                    </text>
                  </g>
                )}
              </g>
            )
          })}
          {ids.map((panel) =>
            edgesOf(rule, panel).map((e) => {
              const a = nodeCenter(panel, e.source)
              const b = nodeCenter(panel, e.target)
              if (!a || !b) return null
              const selected = sel?.kind === 'edge' && sel.panel === panel && sel.id === e.id
              // trim the visible line to the node boundaries so a directed edge's
              // arrowhead sits *outside* the target node and is actually visible.
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
              const ux = (b.x - a.x) / len
              const uy = (b.y - a.y) / len
              const startTrim = Math.min(R, len / 2 - 1)
              const endTrim = Math.min(R + 4, len / 2 - 1)
              const ax = a.x + ux * startTrim
              const ay = a.y + uy * startTrim
              const bx = b.x - ux * endTrim
              const by = b.y - uy * endTrim
              return (
                <g key={'e-' + e.id} className='edge-g'>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className='edge-hit' />
                  <line
                    x1={ax}
                    y1={ay}
                    x2={bx}
                    y2={by}
                    className={selected ? 'edge-line sel' : 'edge-line'}
                    markerEnd={e.directed ? (selected ? 'url(#arrow-sel)' : 'url(#arrow)') : undefined}
                  />
                  {e.label && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} className='edge-label'>
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })
          )}
          {rule.rhs.nodes.map((n) => {
            if (!n.mapFrom) return null
            const a = nodeCenter('lhs', n.mapFrom)
            const b = nodeCenter('rhs', n.id)
            if (!a || !b) return null
            const selected = sel?.kind === 'map' && sel.rhsNodeId === n.id
            return (
              <g key={'m-' + n.id} className='map-g'>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className='map-hit' />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={selected ? 'map-line sel' : 'map-line'} />
              </g>
            )
          })}
          {d?.mode === 'connect' &&
            (() => {
              const from = nodeById(d.panel, d.from)
              if (!from) return null
              const g = panelGeom(d.panel)
              const fx = g.x0 + (from.x ?? 0)
              const fy = g.y0 + (from.y ?? 0)
              return <line x1={fx} y1={fy} x2={d.x} y2={d.y} className='live-link' />
            })()}
          {ids.map((panel) =>
            nodesOf(rule, panel).map((n) => {
              const g = panelGeom(panel)
              const cx = g.x0 + (n.x ?? 0)
              const cy = g.y0 + (n.y ?? 0)
              const pattern = isPattern(panel)
              const isWild = pattern && ((n as PatternNode).wildcard || n.label === '*')
              // Honour the custom node renderer here too, so authoring reflects how a
              // node will look in the host graph. Wildcards keep their ∗ glyph. (LHS
              // state usually lives in predicates, not props, so prop-based styles
              // may not differentiate pattern nodes , that's expected.)
              const st = isWild ? null : resolveNodeStyle(n, app.nodeStyle)
              const color = st ? st.fill : labelColor('*')
              const selected = sel?.kind === 'node' && sel.panel === panel && sel.id === n.id
              const bodyStroke = selected ? '#fff' : st ? st.stroke : darken(color)
              const points = st ? shapePolygonPoints(st.shape, cx, cy, R) : null
              const ringPoints = st?.ring ? shapePolygonPoints(st.shape, cx, cy, R + 3.5) : null
              const glyph = st?.glyph
              // Always keep the label legible while authoring (the editor is a
              // schematic): reflect the resolver's glyph, but ignore a host-oriented
              // `text: null`/override so pattern nodes stay identifiable.
              const bodyText = isWild ? '∗' : glyph ?? (n.label || '?')
              const textFill = st ? st.textColor : textOn(color)
              const inMulti = multi?.panel === panel && multi.ids.has(n.id)
              const badges: string[] = []
              if (pattern) {
                const pn = n as PatternNode
                if (pn.predicates?.length) badges.push(`⚙${pn.predicates.length}`)
                if (pn.exactDegree != null) badges.push(`°${pn.exactDegree}`)
                // redirect-embedding indicator on a deleted (unmapped) LHS node
                if (panel === 'lhs') {
                  const deleted = !rule.rhs.nodes.some((rn) => rn.mapFrom === n.id)
                  if (deleted && rule.embedding.some((e) => e.lhsNodeId === n.id && e.strategy !== 'remove')) badges.push('⤳')
                }
              } else {
                const rn = n as RhsNode
                badges.push(rn.mapFrom ? '↦' : '＋')
                if (rn.setProps && Object.keys(rn.setProps).length) badges.push(`⚙${Object.keys(rn.setProps).length}`)
              }
              return (
                <g key={'n-' + n.id} className='node-g'>
                  {inMulti && <circle cx={cx} cy={cy} r={R + 3.5} fill='none' stroke='#7b5dcd' strokeWidth={2} />}
                  {st?.ring &&
                    (ringPoints
                      ? (
                        <polygon points={ringPoints} fill='none' stroke={st.ring} strokeWidth={2.5} />
                        )
                      : (
                        <circle cx={cx} cy={cy} r={R + 3.5} fill='none' stroke={st.ring} strokeWidth={2.5} />
                        ))}
                  {points
                    ? (
                      <polygon points={points} fill={color} stroke={bodyStroke} strokeWidth={selected ? 3 : 2} className='node-circle' />
                      )
                    : (
                      <circle cx={cx} cy={cy} r={R} fill={color} stroke={bodyStroke} strokeWidth={selected ? 3 : 2} className='node-circle' />
                      )}
                  <text x={cx} y={cy + 5} className='node-text' fill={textFill} textAnchor='middle'>
                    {bodyText}
                  </text>
                  {badges.length > 0 && (
                    <text x={cx + R - 2} y={cy - R + 4} className='node-badge'>
                      {badges.join(' ')}
                    </text>
                  )}
                  <circle cx={cx + R} cy={cy} r={9} className='node-port-hit' data-port={n.id} data-panel={panel} />
                  <circle cx={cx + R} cy={cy} r={4.5} className='node-port' data-port={n.id} data-panel={panel} />
                </g>
              )
            })
          )}
          {marquee.current && (
            <rect
              x={Math.min(marquee.current.x0, marquee.current.x1)}
              y={Math.min(marquee.current.y0, marquee.current.y1)}
              width={Math.abs(marquee.current.x1 - marquee.current.x0)}
              height={Math.abs(marquee.current.y1 - marquee.current.y0)}
              className='marquee-rect'
            />
          )}
        </g>
      </svg>
      <button className='ec-add-nac' title='Add a NAC , a forbidden pattern that blocks the rule when present' onClick={addNac}>
        + NAC
      </button>
      <div className='ec-zoom'>
        <button title='Zoom out' onClick={() => zoomBy(1 / 1.25)}>
          <Minus size={14} />
        </button>
        <button title='Reset view' onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          {Math.round(view.k * 100)}%
        </button>
        <button title='Zoom in' onClick={() => zoomBy(1.25)}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}
