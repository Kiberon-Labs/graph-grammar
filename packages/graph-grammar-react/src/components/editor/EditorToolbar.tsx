import type { Rule } from 'graph-grammar'
import { ArrowRight, Minus } from 'lucide-react'
import { labelColor, textOn } from '../../colors.ts'
import { useApp } from '../../AppContext.tsx'
import { ComboBox } from '../ComboBox.tsx'
import { hostLabels } from './model.ts'

interface Props {
  rule: Rule;
  brush: string;
  setBrush: (s: string) => void;
  newEdgeDirected: boolean;
  setNewEdgeDirected: (v: boolean) => void;
}

export function EditorToolbar ({ rule, brush, setBrush, newEdgeDirected, setNewEdgeDirected }: Props) {
  const app = useApp()
  // Quick-pick chips: labels from the example graph + this rule, so new nodes
  // are stamped with real labels rather than typed by hand.
  const fromGraph = hostLabels(app, rule)
  const labels = new Set<string>(fromGraph)
  labels.add(brush)

  return (
    <div className='editor-toolbar'>
      <span className='tb-label'>New-node label:</span>
      <ComboBox
        className='brush-input'
        value={brush}
        options={fromGraph}
        createLabel='Custom label…'
        placeholder='New label…'
        onChange={setBrush}
      />
      <div className='label-chips'>
        {[...labels].filter(Boolean).map((lbl) => (
          <button
            key={lbl}
            className='chip'
            style={{ background: labelColor(lbl), color: textOn(labelColor(lbl)) }}
            onClick={() => setBrush(lbl)}
          >
            {lbl}
          </button>
        ))}
      </div>
      <button
        className='ghost small edge-dir-toggle'
        title='Direction for new connections (click to flip). Per-edge: select an edge or right-click it.'
        onClick={() => setNewEdgeDirected(!newEdgeDirected)}
      >
        {newEdgeDirected ? <>New edges: <ArrowRight size={13} /> directed</> : <>New edges: <Minus size={13} /> undirected</>}
      </button>
      <span className='tb-spacer' />
      <span className='tb-hint'>
        Dbl-click: add · drag ● port: connect/map · Shift-drag bg: marquee · Ctrl-click: multi · Ctrl C/V: copy/paste · “+ NAC”: forbidden pattern
      </span>
    </div>
  )
}
