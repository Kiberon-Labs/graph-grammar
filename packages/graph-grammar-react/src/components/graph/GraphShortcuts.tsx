import { useState } from 'react'

// Bottom-right cheat-sheet of the graph-workbench interaction shorthands.
const ROWS: { keys: string[]; act: string }[] = [
  { keys: ['Dbl-click'], act: 'Add node' },
  { keys: ['Drag'], act: 'Move node · bg = pan' },
  { keys: ['Shift', 'drag node'], act: 'Connect / spawn' },
  { keys: ['Shift', 'drag bg'], act: 'Marquee select' },
  { keys: ['Ctrl', 'click'], act: 'Toggle in selection' },
  { keys: ['Ctrl', 'C / V'], act: 'Copy / paste' },
  { keys: ['Del'], act: 'Delete selection' },
  { keys: ['H'], act: 'Dim selection · ⇧H show all' },
  { keys: ['Scroll'], act: 'Zoom' },
]

export function GraphShortcuts () {
  const [open, setOpen] = useState(true)
  return (
    <div className={'graph-shortcuts' + (open ? '' : ' collapsed')}>
      <button className='gs-head' onClick={() => setOpen((o) => !o)} title='Toggle shortcuts'>
        <span>⌨ Shortcuts</span>
        <span className='gs-caret'>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className='gs-body'>
          {ROWS.map((r, i) => (
            <div className='gs-row' key={i}>
              <span className='gs-keys'>
                {r.keys.map((k, j) => (
                  <kbd key={j}>{k}</kbd>
                ))}
              </span>
              <span className='gs-act'>{r.act}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
