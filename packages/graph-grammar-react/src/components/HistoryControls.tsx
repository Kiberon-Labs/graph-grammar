import { useEffect } from 'react'
import { Undo2, Redo2 } from 'lucide-react'
import { useApp } from '../AppContext.tsx'
import { useHistory, selectCanUndo, selectCanRedo, selectUndoLabel, selectRedoLabel } from '../history.ts'

// ============================================================================
// Undo / redo controls. Mounted once by the Workbench: it (1) wires AppState's
// onCommit hook to the Zustand history store + seeds the initial snapshot, (2)
// renders the undo/redo buttons (enabled state + action label from the store),
// and (3) installs the Ctrl/⌘+Z · Shift+Z · Y keyboard shortcuts.
// ============================================================================
export function HistoryControls () {
  const app = useApp()
  const canUndo = useHistory(selectCanUndo)
  const canRedo = useHistory(selectCanRedo)
  const undoLabel = useHistory(selectUndoLabel)
  const redoLabel = useHistory(selectRedoLabel)

  // Wire AppState → history once per app, and seed the starting snapshot.
  useEffect(() => {
    app.onCommit = (label) => useHistory.getState().record(label, app.snapshot())
    useHistory.getState().init(app.snapshot())
    return () => {
      app.onCommit = undefined
    }
  }, [app])

  const doUndo = () => {
    const s = useHistory.getState().undo()
    if (s) app.restore(s)
  }
  const doRedo = () => {
    const s = useHistory.getState().redo()
    if (s) app.restore(s)
  }

  // Keyboard: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo. Skip
  // while typing so native text-field undo keeps working.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        doRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app])

  return (
    <div className='history-controls'>
      <button
        className='hc-btn'
        disabled={!canUndo}
        title={canUndo ? `Undo ${undoLabel}  (Ctrl+Z)` : 'Nothing to undo'}
        aria-label='Undo'
        onClick={doUndo}
      >
        <Undo2 size={15} />
      </button>
      <button
        className='hc-btn'
        disabled={!canRedo}
        title={canRedo ? `Redo ${redoLabel}  (Ctrl+Shift+Z)` : 'Nothing to redo'}
        aria-label='Redo'
        onClick={doRedo}
      >
        <Redo2 size={15} />
      </button>
    </div>
  )
}
