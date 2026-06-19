import { useEffect, useRef, useState } from 'react'
import type { GNode, GEdge } from 'graph-grammar'
import { useAppEvent } from '../../AppContext.tsx'
import { useContextMenu } from '../ContextMenu.tsx'
import { GraphRenderer, type GraphMode, type ContextPayload } from '../../graphRenderer.ts'
import { hasClip } from '../../clipboard.ts'
import type { NodeStyleResolver } from '../../nodeStyle.ts'
import { LAYOUTS, type LayoutNode } from '../../layout/index.ts'
import { GraphToolbar } from './GraphToolbar.tsx'
import { GraphNodeInspector } from './GraphNodeInspector.tsx'
import { GraphEdgeInspector } from './GraphEdgeInspector.tsx'
import { GraphShortcuts } from './GraphShortcuts.tsx'

/**
 * React wrapper around the imperative GraphRenderer. React owns the chrome
 * (toolbar, node inspector, context menu); the renderer owns the canvas, the
 * d3-force layout, and pointer interaction. `active` is true when the graph tab
 * is visible , used to (re)frame after the canvas gains real dimensions.
 */
export function GraphCanvas ({ active, nodeStyle }: { active: boolean; nodeStyle?: NodeStyleResolver }) {
  const app = useAppEvent('graph') // revalidate selection when the graph changes
  const menu = useContextMenu()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GraphRenderer | null>(null)

  const [selected, setSelected] = useState<GNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GEdge | null>(null)
  const [mode, setMode] = useState<GraphMode>('select')
  const [brush, setBrush] = useState('A')
  const [showLabels, setShowLabels] = useState(true)
  const [preview, setPreview] = useState(true)
  const [reflow, setReflow] = useState(true)
  const [hiddenEdges, setHiddenEdges] = useState<Set<string>>(new Set())
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set())
  const [respread, setRespread] = useState(false)

  // keep a ref to the latest brush so the context-menu closure stays fresh
  const brushRef = useRef(brush)
  brushRef.current = brush

  const openMenu = (p: ContextPayload) => {
    const r = rendererRef.current!
    if (p.node) {
      const node = p.node
      const n = r.selectionCount()
      const multi = n > 1
      menu.open(p.clientX, p.clientY, [
        { label: multi ? `Copy ${n} nodes` : 'Copy node', hint: 'Ctrl+C', action: () => r.copySelection() },
        hasClip() ? { label: 'Paste here', hint: 'Ctrl+V', action: () => r.paste({ x: p.graphX, y: p.graphY }) } : { separator: true },
        { separator: true },
        {
          label: 'Rename…',
          hint: node.label,
          action: () => {
            const v = prompt('Node label:', node.label)
            if (v != null) r.relabelNode(node, v)
          },
        },
        { label: 'Start edge from here', action: () => r.startEdgeFrom(node) },
        { label: (node as LayoutNode).fx != null ? 'Unpin position' : 'Pin position', action: () => r.pinToggle(node) },
        { separator: true },
        { label: multi ? `Dim ${n} nodes` : 'Dim node', hint: 'H', action: () => r.dimSelection() },
        { label: multi ? 'Focus these (dim rest)' : 'Focus this (dim rest)', action: () => r.focusSelection() },
        ...(r.hasDimmed() ? [{ label: `Show all (${r.dimmedCount()} dimmed)`, hint: '⇧H', action: () => r.clearDimmed() }] : []),
        { separator: true },
        { label: multi ? `Delete ${n} nodes` : 'Delete node', danger: true, action: () => r.deleteSelection() },
      ])
    } else if (p.edge) {
      const edge = p.edge
      menu.open(p.clientX, p.clientY, [
        {
          label: 'Set label…',
          hint: edge.label || '(none)',
          action: () => {
            const v = prompt('Edge label:', edge.label)
            if (v != null) r.relabelEdge(edge, v)
          },
        },
        {
          label: edge.directed ? 'Make undirected' : 'Make directed →',
          action: () => r.setEdgeDirected(edge, !edge.directed),
        },
        { separator: true },
        { label: 'Delete edge', danger: true, action: () => r.deleteEdge(edge) },
      ])
    } else {
      const activeLayout = r.getLayoutKind()
      menu.open(p.clientX, p.clientY, [
        { label: `Add “${brushRef.current}” node here`, action: () => r.addNodeAt(p.graphX, p.graphY, brushRef.current) },
        ...(hasClip() ? [{ label: 'Paste here', hint: 'Ctrl+V', action: () => r.paste({ x: p.graphX, y: p.graphY }) }] : []),
        { separator: true },
        { label: 'Fit to view', action: () => r.recenter() },
        { label: 'Re-run layout', action: () => r.reheat() },
        ...(r.hasDimmed() ? [{ label: `Show all (${r.dimmedCount()} dimmed)`, hint: '⇧H', action: () => r.clearDimmed() }] : []),
        { separator: true },
        ...LAYOUTS.map((l) => ({
          label: `${l.kind === activeLayout ? '✓ ' : '    '}${l.label} layout`,
          hint: l.kind === activeLayout ? undefined : l.blurb,
          action: () => r.setLayout(l.kind),
        })),
      ])
    }
  }

  // create / destroy the renderer with the component
  useEffect(() => {
    const r = new GraphRenderer(canvasRef.current!, app, {
      onSelect: setSelected,
      onSelectEdge: setSelectedEdge,
      onModeChange: setMode,
      onContextMenu: openMenu,
    })
    rendererRef.current = r
    r.mounted()
    return () => {
      r.destroy()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app])

  // re-frame when the tab becomes visible (canvas now has real dimensions)
  useEffect(() => {
    if (active) rendererRef.current?.mounted()
  }, [active])

  // apply the custom node-appearance resolver and repaint
  useEffect(() => {
    app.nodeStyle = nodeStyle
    rendererRef.current?.refresh()
  }, [app, nodeStyle])

  const setBrushBoth = (v: string) => {
    setBrush(v)
    rendererRef.current?.setBrush(v)
  }
  const setModeBoth = (m: GraphMode) => {
    setMode(m)
    rendererRef.current?.setMode(m)
  }
  const setShowLabelsBoth = (v: boolean) => {
    setShowLabels(v)
    rendererRef.current?.setShowLabels(v)
  }
  const setPreviewBoth = (v: boolean) => {
    setPreview(v)
    rendererRef.current?.setPreview(v)
  }
  const setReflowBoth = (v: boolean) => {
    setReflow(v)
    rendererRef.current?.setReheatOnEdgeChange(v)
  }
  const setHiddenEdgesBoth = (next: Set<string>) => {
    setHiddenEdges(next)
    rendererRef.current?.setHiddenEdgeLabels(next)
  }
  const setHiddenNodesBoth = (next: Set<string>) => {
    setHiddenNodes(next)
    rendererRef.current?.setHiddenNodeLabels(next)
  }
  const setRespreadBoth = (v: boolean) => {
    setRespread(v)
    rendererRef.current?.setRespread(v)
  }

  // Distinct node / edge labels (with counts) for the filter. Recomputed whenever
  // the graph changes (`useAppEvent('graph')` re-renders this component).
  const labelCounts = (items: Array<{ label: string }>) => {
    const m = new Map<string, number>()
    for (const it of items) m.set(it.label, (m.get(it.label) ?? 0) + 1)
    return [...m]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }
  const nodeLabels = labelCounts(app.engine.graph.nodes)
  const edgeLabels = labelCounts(app.engine.graph.edges)

  const idx = app.engine.index
  const liveSelected = selected && idx.nodes.has(selected.id) ? selected : null
  const liveEdge = selectedEdge && idx.edges.has(selectedEdge.id) ? selectedEdge : null

  return (
    <div className='graph-view'>
      <canvas ref={canvasRef} className='graph-canvas' />
      <GraphToolbar
        brush={brush}
        setBrush={setBrushBoth}
        mode={mode}
        setMode={setModeBoth}
        showLabels={showLabels}
        setShowLabels={setShowLabelsBoth}
        preview={preview}
        setPreview={setPreviewBoth}
        reflow={reflow}
        setReflow={setReflowBoth}
        nodeLabels={nodeLabels}
        hiddenNodes={hiddenNodes}
        setHiddenNodes={setHiddenNodesBoth}
        edgeLabels={edgeLabels}
        hiddenEdges={hiddenEdges}
        setHiddenEdges={setHiddenEdgesBoth}
        respread={respread}
        setRespread={setRespreadBoth}
      />
      <GraphShortcuts />
      {rendererRef.current && (liveSelected || liveEdge) && (
        <div className='graph-overlay'>
          {liveSelected
            ? (
              <GraphNodeInspector key={liveSelected.id} node={liveSelected} renderer={rendererRef.current} onClose={() => setSelected(null)} />
              )
            : liveEdge
              ? (
                <GraphEdgeInspector key={liveEdge.id} edge={liveEdge} renderer={rendererRef.current} onClose={() => setSelectedEdge(null)} />
                )
              : null}
        </div>
      )}
    </div>
  )
}
