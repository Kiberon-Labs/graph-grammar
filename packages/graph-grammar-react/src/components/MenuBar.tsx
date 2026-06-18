import { useMemo, useRef, useState } from 'react'
import { FilePlus2, Download, Upload, Eraser, Pin, Shuffle, Grid3x3, ClipboardPaste } from 'lucide-react'
import { useApp } from '../AppContext.tsx'
import { exportGrammar, safeImportGrammar, parseGraph, randomGraph, gridGraph } from 'graph-grammar'
import { EXAMPLES, buildExample, type ExampleEntry } from 'graph-grammar/examples'
import { flash } from '../toast.ts'
import { Menu, MenuItem, MenuSeparator, MenuHeading } from './Menu.tsx'
import { Modal } from './Modal.tsx'

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

/** Group example entries by category, preserving first-seen order. */
function groupExamples (list: ExampleEntry[]): Array<[string, ExampleEntry[]]> {
  const order: string[] = []
  const byGroup = new Map<string, ExampleEntry[]>()
  for (const ex of list) {
    if (!byGroup.has(ex.group)) {
      byGroup.set(ex.group, [])
      order.push(ex.group)
    }
    byGroup.get(ex.group)!.push(ex)
  }
  return order.map((g) => [g, byGroup.get(g)!])
}

export interface MenuBarProps {
  /**
   * The example grammars to offer in the "Examples" menu. Omit for the built-in
   * library; pass your own list to customise it; pass `[]` to drop the menu
   * entirely (the editor without bundled examples).
   */
  examples?: ExampleEntry[];
}

/**
 * Application menu bar (File / Graph / Examples). Hosts the save/load mechanics
 * that used to fill the left rail, so the side panel can stay focused on the
 * live run controls. The Examples menu is omitted when `examples` is empty.
 */
export function MenuBar ({ examples }: MenuBarProps = {}) {
  const app = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const graphFileRef = useRef<HTMLInputElement>(null)
  const [showLoadText, setShowLoadText] = useState(false)
  const [text, setText] = useState('')
  const exampleList = examples ?? EXAMPLES
  const groups = useMemo(() => groupExamples(exampleList), [exampleList])

  const newGrammar = () => {
    if (app.grammar.rules.length && !confirm('Start a new blank grammar? The current rules and graph will be replaced.')) return
    app.loadGrammar(buildExample('blank'), 'New grammar')
    flash('New blank grammar')
  }

  const importFile = async (file: File) => {
    const res = safeImportGrammar(await file.text())
    if (!res.ok) return flash(`Invalid grammar file , ${res.error}`)
    app.loadGrammar(res.grammar, `Import “${res.grammar.name}”`)
    flash(`Loaded grammar “${res.grammar.name}”`)
  }

  // Import a graph JSON ({nodes,edges}) as the start graph , e.g. one of the
  // per-quest `<quest>.graph.json` files emitted by the fallout-quest-scraper
  // transform, or anything from "Export graph". Edge-list / DOT text also works.
  const importGraphFile = async (file: File) => {
    try {
      const g = parseGraph(await file.text())
      if (!g.nodes.length) return flash('No nodes parsed from that file')
      app.setStartGraph(g, 'Import graph')
      flash(`Loaded ${g.nodes.length} nodes from ${file.name}`)
    } catch {
      flash('Could not parse that graph file')
    }
  }

  const loadFromText = () => {
    try {
      const g = parseGraph(text)
      if (!g.nodes.length) return flash('No nodes parsed')
      app.setStartGraph(g, 'Load graph from text')
      flash(`Loaded ${g.nodes.length} nodes`)
      setShowLoadText(false)
    } catch {
      flash('Parse error')
    }
  }

  return (
    <div className='menu-bar'>
      <Menu label='File'>
        <MenuItem icon={<FilePlus2 size={14} />} label='New grammar' onClick={newGrammar} />
        <MenuSeparator />
        <MenuItem icon={<Upload size={14} />} label='Import grammar…' onClick={() => fileRef.current?.click()} />
        <MenuItem icon={<Upload size={14} />} label='Import graph…' hint='.json' onClick={() => graphFileRef.current?.click()} />
        <MenuItem icon={<Download size={14} />} label='Export grammar' onClick={() => download(`${slug(app.grammar.name)}.grammar.json`, exportGrammar(app.grammar))} />
        <MenuItem icon={<Download size={14} />} label='Export graph' hint='.json' onClick={() => download('graph.json', JSON.stringify(app.engine.graph, null, 2))} />
      </Menu>

      <Menu label='Graph'>
        <MenuItem icon={<ClipboardPaste size={14} />} label='Load from text…' hint='paste' onClick={() => setShowLoadText(true)} />
        <MenuItem icon={<Pin size={14} />} label='Pin current as start' onClick={() => { app.pinCurrentAsStart(); flash('Pinned current graph as start') }} />
        <MenuItem icon={<Eraser size={14} />} label='Clear graph' danger onClick={() => app.setStartGraph({ nodes: [], edges: [] }, 'Clear graph')} />
        <MenuSeparator />
        <MenuHeading>Generate</MenuHeading>
        <MenuItem icon={<Shuffle size={14} />} label='Random , 200 nodes' onClick={() => app.setStartGraph(randomGraph(200, 1.6, ['A', 'B', 'C']), 'Generate random graph')} />
        <MenuItem icon={<Shuffle size={14} />} label='Random , 2000 nodes' hint='stress' onClick={() => app.setStartGraph(randomGraph(2000, 1.4, ['A', 'B', 'C', 'D']), 'Generate random graph')} />
        <MenuItem icon={<Grid3x3 size={14} />} label='Grid , 12 × 12' onClick={() => app.setStartGraph(gridGraph(12, 12, 'A'), 'Generate grid graph')} />
      </Menu>

      {exampleList.length > 0 && (
        <Menu label='Examples'>
          {groups.map(([group, items], gi) => (
            <div key={group}>
              {gi > 0 && <MenuSeparator />}
              <MenuHeading>{group}</MenuHeading>
              {items.map((ex) => (
                <MenuItem key={ex.key} label={ex.title} onClick={() => app.loadGrammar(ex.build())} />
              ))}
            </div>
          ))}
        </Menu>
      )}

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
      <input
        ref={graphFileRef}
        type='file'
        accept='.json,application/json'
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importGraphFile(f)
          e.target.value = ''
        }}
      />

      {showLoadText && (
        <Modal
          title='Load graph from text'
          onClose={() => setShowLoadText(false)}
          footer={
            <>
              <button className='ghost small' onClick={() => setShowLoadText(false)}>Cancel</button>
              <button className='primary small' onClick={loadFromText}>Load as start</button>
            </>
          }
        >
          <textarea
            className='graph-input'
            rows={8}
            autoFocus
            placeholder='Paste a graph: edge list (A -> B), DOT, or JSON {nodes,edges}'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Modal>
      )}
    </div>
  )
}
