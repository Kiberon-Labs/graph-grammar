import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppEvent } from '../../AppContext.tsx'
import { rule as makeRule, type Rule } from 'graph-grammar'
import { RuleRow } from './RuleRow.tsx'
import { CollapsibleGroup } from '../Collapsible.tsx'

const CAP = 200
const UNGROUPED = 'Ungrouped'

/** Sidebar list of rules with live match-count badges, reordering, and
 *  collapsible rule groups (by each rule's optional `group`). */
export function RuleList () {
  const app = useAppEvent('rules', 'selectRule', 'graph')
  const counts = app.engine.matchCounts(CAP)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const newRule = () => {
    app.addRule(makeRule({ name: `Rule ${app.grammar.rules.length + 1}`, lhs: { nodes: [], edges: [] }, rhs: { nodes: [], edges: [] } }))
  }

  const renderRow = (r: Rule) => {
    const count = counts[r.id] ?? 0
    return (
      <RuleRow
        key={r.id}
        rule={r}
        count={count}
        cap={CAP}
        blocked={count > 0 && app.engine.isBlockedByNodeCap(r)}
        active={r.id === app.activeRuleId}
      />
    )
  }

  const rules = app.grammar.rules
  const hasGroups = rules.some((r) => r.group)

  // Group rules by their `group`, preserving first-seen order. Ungrouped rules
  // collect under a trailing "Ungrouped" section (only shown when some rules are
  // grouped , otherwise the list renders flat, exactly as before).
  const order: string[] = []
  const byGroup = new Map<string, Rule[]>()
  for (const r of rules) {
    const g = r.group || UNGROUPED
    if (!byGroup.has(g)) {
      byGroup.set(g, [])
      order.push(g)
    }
    byGroup.get(g)!.push(r)
  }

  const toggle = (g: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })

  const setGroupEnabled = (group: Rule[], enabled: boolean) => {
    for (const r of group) r.enabled = enabled
    app.touchRules()
  }

  return (
    <div className='rule-list'>
      <div className='panel-head'>
        <h3>Rules</h3>
        <button className='primary small' onClick={newRule}>
          <Plus size={14} /> New rule
        </button>
      </div>
      <div className='rules'>
        {!hasGroups && rules.map(renderRow)}
        {hasGroups &&
          order.map((g) => {
            const group = byGroup.get(g)!
            const allOn = group.every((r) => r.enabled)
            const someOn = group.some((r) => r.enabled)
            return (
              <CollapsibleGroup
                key={g}
                title={g}
                collapsed={collapsed.has(g)}
                onToggle={() => toggle(g)}
                right={
                  <>
                    <span className='group-count'>{group.length}</span>
                    <input
                      type='checkbox'
                      className='group-enable'
                      title={allOn ? 'Disable all in group' : 'Enable all in group'}
                      checked={allOn}
                      ref={(el) => { if (el) el.indeterminate = someOn && !allOn }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setGroupEnabled(group, e.target.checked)}
                    />
                  </>
                }
              >
                <div className='rules'>{group.map(renderRow)}</div>
              </CollapsibleGroup>
            )
          })}
        {rules.length === 0 && <div className='empty-hint'>No rules yet , create one to begin.</div>}
      </div>
    </div>
  )
}
