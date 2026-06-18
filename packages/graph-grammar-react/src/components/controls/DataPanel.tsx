import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useApp } from '../../AppContext.tsx'
import { exportGrammar, safeImportGrammar, parseGraph, randomGraph, gridGraph } from 'graph-grammar'
import { flash } from '../../toast.ts'

function download (filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grammar'

export function DataPanel () {
  const app = useApp()
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadAsStart = () => {
    try {
      const g = parseGraph(text)
      if (!g.nodes.length) return flash('No nodes parsed')
      app.setStartGraph(g)
      flash(`Loaded ${g.nodes.length} nodes`)
    } catch {
      flash('Parse error')
    }
  }

  const importFile = async (file: File) => {
    const res = safeImportGrammar(await file.text())
    if (!res.ok) return flash(`Invalid grammar file , ${res.error}`)
    app.loadGrammar(res.grammar)
    flash(`Loaded grammar “${res.grammar.name}”`)
  }

  return (
    <section className='panel-section'>
      <h3>Graph &amp; data</h3>
      <textarea
        className='graph-input'
        rows={4}
        placeholder='Paste a graph: edge list (A -> B), DOT, or JSON {nodes,edges}'
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className='btn-row'>
        <button className='primary small' onClick={loadAsStart}>Load as start</button>
        <button className='ghost small' onClick={() => app.setStartGraph({ nodes: [], edges: [] })}>Clear graph</button>
      </div>
      <div className='btn-row'>
        <button className='ghost small' onClick={() => app.setStartGraph(randomGraph(200, 1.6, ['A', 'B', 'C']))}>Random 200</button>
        <button className='ghost small' title='Stress test the renderer & matcher' onClick={() => app.setStartGraph(randomGraph(2000, 1.4, ['A', 'B', 'C', 'D']))}>Random 2000</button>
        <button className='ghost small' onClick={() => app.setStartGraph(gridGraph(12, 12, 'A'))}>Grid 12×12</button>
      </div>
      <div className='divider' />
      <div className='btn-row'>
        <button className='ghost small' onClick={() => download(`${slug(app.grammar.name)}.grammar.json`, exportGrammar(app.grammar))}><Download size={13} /> Export grammar</button>
        <button className='ghost small' onClick={() => fileRef.current?.click()}><Upload size={13} /> Import grammar</button>
        <button className='ghost small' onClick={() => download('graph.json', JSON.stringify(app.engine.graph, null, 2))}><Download size={13} /> Export graph</button>
      </div>
      <input
        ref={fileRef}
        type='file'
        accept='.json'
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importFile(f)
          e.target.value = ''
        }}
      />
    </section>
  )
}
