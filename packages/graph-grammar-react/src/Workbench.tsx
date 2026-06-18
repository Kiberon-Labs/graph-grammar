import { useState, type ReactNode } from 'react'
import { Workflow, SquarePen } from 'lucide-react'
import { EXAMPLES, type ExampleEntry } from 'graph-grammar/examples'
import type { AppState } from './state.ts'
import type { NodeStyleResolver } from './nodeStyle.ts'
import { AppProvider } from './AppContext.tsx'
import { ContextMenuProvider } from './components/ContextMenu.tsx'
import { Header } from './components/Header.tsx'
import { HistoryControls } from './components/HistoryControls.tsx'
import { ResizeHandle } from './components/ResizeHandle.tsx'
import { ControlPanel } from './components/controls/ControlPanel.tsx'
import { RuleList } from './components/rules/RuleList.tsx'
import { GraphCanvas } from './components/graph/GraphCanvas.tsx'
import { RuleEditor } from './components/editor/RuleEditor.tsx'

type Tab = 'graph' | 'editor'

// rail width bounds (px)
const RAIL_MIN = 190
const RAIL_MAX = 520

export interface WorkbenchProps {
  /** The controller. Construct with `new AppState()` and drive it from outside. */
  app: AppState;
  /**
   * The top bar. `true` (default) renders the built-in branded header; `false`
   * hides it (handy when embedding under your own chrome); or pass your own
   * node to replace it.
   */
  header?: boolean | ReactNode;
  /**
   * Custom per-node appearance for the host graph canvas. A function of the
   * node (its `label` + `props`) returning style overrides , e.g. to draw an
   * infected person as a red diamond. Omit for the default label-coloured circles.
   */
  nodeStyle?: NodeStyleResolver;
  /**
   * Whether to include the bundled example grammars in the header's Examples
   * menu. `true`  uses the built-in library; `false` (default) drops the menu
   * (the editor with no bundled examples); or pass your own `ExampleEntry[]` to
   * offer a custom set.
   */
  examples?: boolean | ExampleEntry[];
}

/**
 * The complete graph-grammar editor as a single embeddable component.
 *
 * Layout: left rail = run controls, middle rail = rule list, right = the live
 * graph workbench / rule editor (the graph canvas is kept mounted so the
 * d3/canvas renderer survives view switches). Both rails are drag-resizable, and
 * the view switcher rides in the header to keep the canvas full-height.
 *
 * For finer-grained embedding, compose the building blocks directly
 * (`AppProvider` + `GraphCanvas` / `RuleEditor` / `RuleList` / `ControlPanel`).
 */
export function Workbench ({ app, header = true, nodeStyle, examples = false }: WorkbenchProps) {
  const [tab, setTab] = useState<Tab>('graph')
  const [leftW, setLeftW] = useState(290)
  const [midW, setMidW] = useState(270)

  // Resolve the examples choice to a concrete list: true → built-in library,
  // false → none, or a caller-supplied custom set.
  const exampleList: ExampleEntry[] = examples === true ? EXAMPLES : examples === false ? [] : examples

  // Undo/redo controls + the view switcher share the header's right slot.
  // HistoryControls is mounted once here (it also wires AppState ↔ history and
  // installs the global undo/redo shortcuts), so it sits in whichever slot is
  // visible , the built-in header, or the fallback tab-bar.
  const switcher = (
    <div className='header-tools'>
      <HistoryControls />
      <div className='view-switch'>
        <button className={'tab' + (tab === 'graph' ? ' active' : '')} onClick={() => setTab('graph')}>
          <Workflow size={15} /> Graph workbench
        </button>
        <button
          className={'tab' + (tab === 'editor' ? ' active' : '')}
          title='Select a rule on the left, then open the Rule editor'
          onClick={() => setTab('editor')}
        >
          <SquarePen size={15} /> Rule editor
        </button>
      </div>
    </div>
  )

  return (
    <AppProvider app={app}>
      <ContextMenuProvider>
        <div className='gg-workbench'>
          {header === true ? <Header right={switcher} examples={exampleList} /> : header === false ? null : header}
          {/* When the built-in header is replaced/hidden, keep the switcher reachable. */}
          {header !== true && <div className='tab-bar'>{switcher}</div>}
          <div className='main'>
            {/* The run controls aren't needed while authoring a rule , hide the
                rail on the editor tab to give the canvas more room (kept mounted
                so the Play timer survives view switches). */}
            <aside className='rail left' style={{ width: leftW, display: tab === 'graph' ? undefined : 'none' }}>
              <ControlPanel />
            </aside>
            <ResizeHandle value={leftW} min={RAIL_MIN} max={RAIL_MAX} onChange={setLeftW} hidden={tab !== 'graph'} />
            <aside className='rail mid' style={{ width: midW }}>
              <RuleList />
            </aside>
            <ResizeHandle value={midW} min={RAIL_MIN} max={RAIL_MAX} onChange={setMidW} />
            <section className='right'>
              <div className='right-content'>
                <div style={{ flex: 1, minWidth: 0, display: tab === 'graph' ? 'flex' : 'none' }}>
                  <GraphCanvas active={tab === 'graph'} nodeStyle={nodeStyle} />
                </div>
                {tab === 'editor' && <RuleEditor />}
              </div>
            </section>
          </div>
        </div>
      </ContextMenuProvider>
    </AppProvider>
  )
}
