import { useEffect, useState } from 'react'
import { ArrowRight, Minus } from 'lucide-react'
import type { GEdge } from 'graph-grammar'
import type { GraphRenderer } from '../../graphRenderer.ts'

interface Props {
  edge: GEdge;
  renderer: GraphRenderer;
  onClose: () => void;
}

/** Floating inspector for a selected host edge (overlay on the canvas). */
export function GraphEdgeInspector ({ edge, renderer, onClose }: Props) {
  const [label, setLabel] = useState(edge.label)
  useEffect(() => setLabel(edge.label), [edge])

  return (
    <div className='node-inspector'>
      <div className='ni-title'>Edge</div>
      <label className='field'>
        <span className='field-label'>Label (blank = none)</span>
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
            renderer.relabelEdge(edge, e.target.value)
          }}
        />
      </label>
      <label className='field'>
        <span className='field-label'>Direction</span>
        <div className='segmented'>
          <button className={'seg' + (edge.directed ? ' active' : '')} onClick={() => renderer.setEdgeDirected(edge, true)}>
            <ArrowRight size={13} /> Directed
          </button>
          <button className={'seg' + (!edge.directed ? ' active' : '')} onClick={() => renderer.setEdgeDirected(edge, false)}>
            <Minus size={13} /> Undirected
          </button>
        </div>
      </label>
      <button
        className='danger small'
        onClick={() => {
          renderer.deleteEdge(edge)
          onClose()
        }}
      >
        Delete edge
      </button>
    </div>
  )
}
