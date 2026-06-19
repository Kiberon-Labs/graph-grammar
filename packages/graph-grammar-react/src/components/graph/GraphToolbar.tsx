import { Spline } from 'lucide-react'
import type { GraphMode } from '../../graphRenderer.ts'
import { GraphFilter } from './GraphFilter.tsx'

interface LabelCount { label: string; count: number }

interface Props {
  brush: string;
  setBrush: (s: string) => void;
  mode: GraphMode;
  setMode: (m: GraphMode) => void;
  showLabels: boolean;
  setShowLabels: (v: boolean) => void;
  preview: boolean;
  setPreview: (v: boolean) => void;
  reflow: boolean;
  setReflow: (v: boolean) => void;
  nodeLabels: LabelCount[];
  hiddenNodes: Set<string>;
  setHiddenNodes: (next: Set<string>) => void;
  edgeLabels: LabelCount[];
  hiddenEdges: Set<string>;
  setHiddenEdges: (next: Set<string>) => void;
  respread: boolean;
  setRespread: (v: boolean) => void;
}

/** Floating toolbar over the host-graph canvas. Layout engine, Fit, and Re-run
 *  layout live in the canvas right-click menu, so this stays focused on the
 *  editing brush and display toggles. */
export function GraphToolbar (p: Props) {
  return (
    <div className='graph-toolbar'>
      <span className='tb-label'>Add-node label:</span>
      <input
        className='brush-input'
        value={p.brush}
        title='Label for nodes you add'
        onChange={(e) => p.setBrush(e.target.value)}
      />
      <button
        className={'ghost small' + (p.mode === 'addEdge' ? ' active' : '')}
        title='When on, drag node→node to connect'
        onClick={() => p.setMode(p.mode === 'addEdge' ? 'select' : 'addEdge')}
      >
        <Spline size={13} /> {p.mode === 'addEdge' ? 'Add edge: ON' : 'Add edge: off'}
      </button>
      <label className='tb-check' title='Highlight where the selected rule currently matches'>
        <input type='checkbox' checked={p.preview} onChange={(e) => p.setPreview(e.target.checked)} />
        match preview
      </label>
      <label className='tb-check'>
        <input type='checkbox' checked={p.showLabels} onChange={(e) => p.setShowLabels(e.target.checked)} />
        labels
      </label>
      <GraphFilter
        nodeLabels={p.nodeLabels}
        hiddenNodes={p.hiddenNodes}
        setHiddenNodes={p.setHiddenNodes}
        edgeLabels={p.edgeLabels}
        hiddenEdges={p.hiddenEdges}
        setHiddenEdges={p.setHiddenEdges}
        respread={p.respread}
        setRespread={p.setRespread}
      />
      <label
        className='tb-check'
        title="Re-settle the layout when a rule rewires edges (e.g. bonds forming/breaking). Off = keep positions fixed through edge-only rewrites, so a run won't shift the layout unless nodes are added or removed."
      >
        <input type='checkbox' checked={p.reflow} onChange={(e) => p.setReflow(e.target.checked)} />
        reflow
      </label>
    </div>
  )
}
