import { useReducer, useState } from 'react'
import { X } from 'lucide-react'
import { useAppEvent } from '../../AppContext.tsx'
import { ensureLayout, hostLabels, syncMorphism, nodesOf, edgesOf, panelGeom, viewSize, type Sel } from './model.ts'
import { EditorToolbar } from './EditorToolbar.tsx'
import { EditorCanvas } from './EditorCanvas.tsx'
import { Inspector } from './Inspector.tsx'
import { RuleHeader } from './RuleHeader.tsx'

/**
 * The rule authoring view. Composes a toolbar, the dual-panel SVG canvas, and a
 * context-sensitive inspector. The editor owns its transient UI state (brush,
 * new-edge direction, selection); structural edits are committed back to the
 * grammar via app.touchRules() so the other views (match preview, badges) update.
 */
export function RuleEditor () {
  // re-render when the active rule changes (selection / add / remove)
  const app = useAppEvent('selectRule')
  const rule = app.activeRule
  // Default the new-node brush to a real label from the example graph.
  const [brush, setBrush] = useState(() => hostLabels(app)[0] ?? 'A')
  const [newEdgeDirected, setNewEdgeDirected] = useState(true)
  const [sel, setSel] = useState<Sel>(null)
  // bump to re-render after a structural edit (positions, labels, topology)
  const [, commitTick] = useReducer((x: number) => x + 1, 0)

  if (!rule) {
    return <div className='rule-editor'><div className='empty-hint'>No rule selected. Create one with “+ New rule”.</div></div>
  }

  ensureLayout(rule)

  const commit = () => {
    app.touchRules()
    commitTick()
  }

  const deleteSelection = () => {
    if (!sel) return
    if (sel.kind === 'node') {
      const arr = nodesOf(rule, sel.panel)
      const i = arr.findIndex((n) => n.id === sel.id)
      if (i >= 0) arr.splice(i, 1)
      const edges = edgesOf(rule, sel.panel)
      for (let k = edges.length - 1; k >= 0; k--) { if (edges[k].source === sel.id || edges[k].target === sel.id) edges.splice(k, 1) }
      if (sel.panel === 'lhs') for (const n of rule.rhs.nodes) if (n.mapFrom === sel.id) n.mapFrom = null
      syncMorphism(rule)
    } else if (sel.kind === 'edge') {
      const edges = edgesOf(rule, sel.panel)
      const i = edges.findIndex((e) => e.id === sel.id)
      if (i >= 0) edges.splice(i, 1)
    } else if (sel.kind === 'map') {
      const n = rule.rhs.nodes.find((x) => x.id === sel.rhsNodeId)
      if (n) n.mapFrom = null
      syncMorphism(rule)
    }
    setSel(null)
    commit()
  }

  // Dock the inspector opposite the panel being edited: a panel on the left half
  // gets a right-docked inspector and vice-versa (so it never covers your work).
  const dockSide =
    sel && sel.kind !== 'map'
      ? panelGeom(sel.panel).x0 + panelGeom(sel.panel).w / 2 >= viewSize(rule).w / 2
        ? 'left'
        : 'right'
      : 'left'

  return (
    <div className='rule-editor'>
      <RuleHeader key={rule.id} rule={rule} />
      <EditorToolbar rule={rule} brush={brush} setBrush={setBrush} newEdgeDirected={newEdgeDirected} setNewEdgeDirected={setNewEdgeDirected} />
      <div className='editor-body'>
        <EditorCanvas
          rule={rule}
          sel={sel}
          setSel={setSel}
          brush={brush}
          newEdgeDirected={newEdgeDirected}
          commit={commit}
          onDelete={deleteSelection}
        />
        {sel && (
          // Dock the inspector on the OPPOSITE side of the element being edited so
          // it doesn't cover (and block clicks on) the panel you're working in.
          <div className={'editor-inspector ' + dockSide}>
            <button className='ei-close icon-btn' title='Close (deselect)' onClick={() => setSel(null)}>
              <X size={15} />
            </button>
            <Inspector
              key={sel.kind === 'map' ? 'map-' + sel.rhsNodeId : sel.kind + '-' + sel.panel + '-' + sel.id}
              rule={rule}
              sel={sel}
              commit={commit}
              onDelete={deleteSelection}
            />
          </div>
        )}
      </div>
    </div>
  )
}
