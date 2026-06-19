import { useEffect, useRef, useState } from 'react'
import { Filter, Plus, X } from 'lucide-react'
import { useViews, type FilterState, type SavedView } from '../../views.ts'

interface LabelCount { label: string; count: number }

/** True when a hidden-label set equals a saved view's stored array. */
const sameSet = (a: Set<string>, b: string[]): boolean => a.size === b.length && b.every((x) => a.has(x))

interface SectionProps {
  title: string;
  labels: LabelCount[];
  hidden: Set<string>;
  setHidden: (next: Set<string>) => void;
}

/** One titled list of label checkboxes with all / none shortcuts. */
function Section ({ title, labels, hidden, setHidden }: SectionProps) {
  const toggle = (label: string) => {
    const next = new Set(hidden)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    setHidden(next)
  }
  return (
    <div className='ef-section'>
      <div className='ef-head'>
        <span>{title}</span>
        <span className='ef-actions'>
          <button className='ghost small' disabled={!labels.length} onClick={() => setHidden(new Set())}>all</button>
          <button className='ghost small' disabled={!labels.length} onClick={() => setHidden(new Set(labels.map((l) => l.label)))}>none</button>
        </span>
      </div>
      <div className='ef-list'>
        {labels.length === 0
          ? <div className='ef-empty'>none</div>
          : labels.map(({ label, count }) => (
            <label key={label} className='ef-row' title={label || '(no label)'}>
              <input type='checkbox' checked={!hidden.has(label)} onChange={() => toggle(label)} />
              <span className='ef-name'>{label || <em>(no label)</em>}</span>
              <span className='ef-count'>{count}</span>
            </label>
          ))}
      </div>
    </div>
  )
}

interface Props {
  nodeLabels: LabelCount[];
  hiddenNodes: Set<string>;
  setHiddenNodes: (next: Set<string>) => void;
  edgeLabels: LabelCount[];
  hiddenEdges: Set<string>;
  setHiddenEdges: (next: Set<string>) => void;
  respread: boolean;
  setRespread: (v: boolean) => void;
}

/**
 * Popover that switches nodes and edges on/off by label. By default it's a pure
 * display filter (hidden elements vanish but stay in the layout, so toggling
 * never moves anything). With "re-spread layout" on, hidden elements are dropped
 * from the force layout so the rest re-settles around what remains.
 */
export function GraphFilter (p: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const views = useViews((s) => s.views)
  const saveView = useViews((s) => s.save)
  const updateView = useViews((s) => s.update)
  const removeView = useViews((s) => s.remove)

  // The currently *selected* view — set when one is applied or saved, and kept
  // even after the filter is edited (so "update" stays available). This is what
  // makes the chip highlight + update button track the user's intent rather than
  // an exact filter match. Cleared only when its view is deleted.
  const [activeId, setActiveId] = useState<string | null>(null)

  const current: FilterState = {
    hiddenNodes: [...p.hiddenNodes],
    hiddenEdges: [...p.hiddenEdges],
    respread: p.respread,
  }
  const activeView = views.find((v) => v.id === activeId)
  // The current filter has diverged from the selected view (unsaved changes).
  const dirty = !!activeView &&
    !(activeView.respread === p.respread && sameSet(p.hiddenNodes, activeView.hiddenNodes) && sameSet(p.hiddenEdges, activeView.hiddenEdges))

  const applyView = (v: SavedView) => {
    setActiveId(v.id)
    p.setHiddenNodes(new Set(v.hiddenNodes))
    p.setHiddenEdges(new Set(v.hiddenEdges))
    p.setRespread(v.respread)
  }
  const saveCurrent = () => {
    const name = window.prompt('Save current filter as view:')?.trim()
    if (name) setActiveId(saveView(name, current))
  }
  const deleteView = (id: string) => {
    removeView(id)
    if (id === activeId) setActiveId(null)
  }

  // close on click outside / Escape while open
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hiddenCount = p.hiddenNodes.size + p.hiddenEdges.size
  const total = p.nodeLabels.length + p.edgeLabels.length

  return (
    <div className='edge-filter' ref={ref}>
      <button
        className={'ghost small' + (hiddenCount ? ' active' : '')}
        title='Show / hide nodes and edges by label'
        disabled={total === 0}
        onClick={() => setOpen((o) => !o)}
      >
        <Filter size={13} /> {activeView ? activeView.name + (dirty ? ' •' : '') : 'filter'}{!activeView && hiddenCount ? ` (${hiddenCount} off)` : ''}
      </button>
      {open && total > 0 && (
        <div className='edge-filter-panel'>
          <div className='ef-section'>
            <div className='ef-head'>
              <span>Views</span>
              <span className='ef-actions'>
                {activeView && (
                  <button
                    className={'ghost small' + (dirty ? ' active' : '')}
                    disabled={!dirty}
                    title={dirty ? `Overwrite "${activeView.name}" with the current filter` : 'No changes to save'}
                    onClick={() => updateView(activeView.id, current)}
                  >update
                  </button>
                )}
                <button className='ghost small' title='Save the current filter as a new view' onClick={saveCurrent}><Plus size={11} /> save</button>
              </span>
            </div>
            <div className='ef-view-list'>
              {views.length === 0
                ? <div className='ef-empty'>no saved views</div>
                : views.map((v) => (
                  <span key={v.id} className={'ef-chip' + (v.id === activeId ? ' active' : '')}>
                    <button className='ef-chip-apply' title='Apply this view' onClick={() => applyView(v)}>{v.name}{v.id === activeId && dirty ? ' •' : ''}</button>
                    <button className='ef-chip-del' title='Delete view' onClick={() => deleteView(v.id)}><X size={11} /></button>
                  </span>
                ))}
            </div>
          </div>
          <label className='ef-respread' title='Drop hidden nodes/edges from the force layout so the graph re-settles around what remains'>
            <input type='checkbox' checked={p.respread} onChange={(e) => p.setRespread(e.target.checked)} />
            re-spread layout
          </label>
          <Section title='Nodes' labels={p.nodeLabels} hidden={p.hiddenNodes} setHidden={p.setHiddenNodes} />
          <Section title='Edges' labels={p.edgeLabels} hidden={p.hiddenEdges} setHidden={p.setHiddenEdges} />
        </div>
      )}
    </div>
  )
}
