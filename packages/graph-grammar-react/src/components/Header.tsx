import { useEffect, useState, type ReactNode } from 'react'
import { Hexagon } from 'lucide-react'
import type { ExampleEntry } from 'graph-grammar/examples'
import { useAppEvent } from '../AppContext.tsx'
import { MenuBar } from './MenuBar.tsx'

/** Top bar. `right` fills the right-hand slot (the Workbench puts the
 *  view switcher there); when omitted it shows the tagline. `examples` is
 *  forwarded to the MenuBar's Examples menu (omit for the built-in set, `[]`
 *  to drop it). */
export function Header ({ right, examples }: { right?: ReactNode; examples?: ExampleEntry[] }) {
  const app = useAppEvent('grammar')
  const [name, setName] = useState(app.grammar.name)
  // reflect external grammar changes (e.g. loading an example)
  useEffect(() => setName(app.grammar.name), [app.grammar])

  return (
    <header className='app-header'>
      <div className='brand'>
        <Hexagon className='logo' size={20} strokeWidth={2.2} />
        <span>Graph Grammar</span>
      </div>
      <MenuBar examples={examples} />
      <input
        className='grammar-name'
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          app.grammar.name = e.target.value
        }}
      />
      <div className='header-right'>
        {right ?? <span className='muted'>a visual graph-rewriting playground</span>}
      </div>
    </header>
  )
}
