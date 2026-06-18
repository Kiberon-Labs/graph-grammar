import { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import type { GNode } from 'graph-grammar'
import type { GraphRenderer } from '../../graphRenderer.ts'
import { coerce } from '../../util.ts'

interface Props {
  node: GNode;
  renderer: GraphRenderer;
  onClose: () => void;
}

/** Floating inspector for a selected host node (overlay on the canvas). */
export function GraphNodeInspector ({ node, renderer, onClose }: Props) {
  const [label, setLabel] = useState(node.label)
  const [, bump] = useState(0)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')

  useEffect(() => setLabel(node.label), [node])

  return (
    <div className='node-inspector'>
      <div className='ni-title'>Node</div>
      <label className='field'>
        <span className='field-label'>Label</span>
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
            renderer.relabelNode(node, e.target.value)
          }}
        />
      </label>
      <div className='ni-props'>
        {Object.entries(node.props).map(([k, v]) => (
          <div className='pred-row' key={k}>
            <span className='prop-key'>{k}</span>
            <input
              className='pred-val'
              defaultValue={String(v ?? '')}
              onChange={(e) => {
                node.props[k] = coerce(e.target.value)
                renderer.notifyPropsChanged()
              }}
            />
            <button
              className='icon-btn'
              onClick={() => {
                delete node.props[k]
                renderer.notifyPropsChanged()
                bump((x) => x + 1)
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <div className='pred-row'>
          <input className='pred-key' placeholder='key' value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input className='pred-val' placeholder='value' value={newVal} onChange={(e) => setNewVal(e.target.value)} />
          <button
            className='icon-btn'
            onClick={() => {
              if (newKey.trim()) {
                node.props[newKey.trim()] = coerce(newVal)
                setNewKey('')
                setNewVal('')
                renderer.notifyPropsChanged()
                bump((x) => x + 1)
              }
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <button
        className='danger small'
        onClick={() => {
          renderer.deleteNode(node)
          onClose()
        }}
      >
        Delete node
      </button>
    </div>
  )
}
