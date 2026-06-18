import { useMemo, useState } from 'react'
import { useApp } from '../../AppContext.tsx'
import { EXAMPLES, type ExampleEntry } from 'graph-grammar/examples'
import { CollapsibleGroup } from '../Collapsible.tsx'

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

export interface ExampleGalleryProps {
  /** Examples to show, grouped by category. Omit for the built-in library;
   *  pass `[]` to render nothing. */
  examples?: ExampleEntry[];
}

export function ExampleGallery ({ examples }: ExampleGalleryProps = {}) {
  const app = useApp()
  const list = examples ?? EXAMPLES
  const groups = useMemo(() => groupExamples(list), [list])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  if (list.length === 0) return null

  const toggle = (g: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })

  return (
    <section className='panel-section'>
      <h3>Examples</h3>
      <div className='example-groups'>
        {groups.map(([group, items]) => (
          <CollapsibleGroup
            key={group}
            title={group}
            collapsed={collapsed.has(group)}
            onToggle={() => toggle(group)}
            right={<span className='group-count'>{items.length}</span>}
          >
            <div className='example-grid'>
              {items.map((ex) => (
                <button key={ex.key} className='example-card' onClick={() => app.loadGrammar(ex.build())}>
                  <div className='ex-title'>{ex.title}</div>
                  <div className='ex-blurb'>{ex.blurb}</div>
                </button>
              ))}
            </div>
          </CollapsibleGroup>
        ))}
      </div>
    </section>
  )
}
