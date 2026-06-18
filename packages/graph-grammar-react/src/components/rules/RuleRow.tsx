import type { Rule } from 'graph-grammar'
import { ChevronUp, ChevronDown, Copy, X, Lock } from 'lucide-react'
import { useApp } from '../../AppContext.tsx'
import { labelColor } from '../../colors.ts'
import { rule as makeRule } from 'graph-grammar'

function Chip ({ children }: { children: React.ReactNode }) {
  return <span className='meta-chip'>{children}</span>
}

export function RuleRow ({ rule, count, cap, active, blocked }: { rule: Rule; count: number; cap: number; active: boolean; blocked?: boolean }) {
  const app = useApp()
  const badge = count >= cap ? `${cap}+` : String(count)

  const duplicate = () => {
    const copy = structuredClone(rule)
    copy.id = makeRule({ name: '', lhs: { nodes: [], edges: [] }, rhs: { nodes: [], edges: [] } }).id
    copy.name = rule.name + ' (copy)'
    app.addRule(copy)
  }

  return (
    <div className={'rule-row' + (active ? ' active' : '')} onClick={() => app.selectRule(rule.id)}>
      <div className='rule-row-top'>
        <input
          type='checkbox'
          checked={rule.enabled}
          title='Enable/disable in runs'
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            rule.enabled = e.target.checked
            app.touchRules()
          }}
        />
        <span
          className={'match-badge' + (blocked ? ' blocked' : count > 0 ? ' has' : '')}
          title={blocked ? `${count} matches, but blocked , firing would exceed Max nodes` : `${count} current matches`}
        >
          {blocked ? <>{badge} <Lock size={11} /></> : badge}
        </span>
        <div className='rule-main'>
          <div className='rule-name-row'>
            <span className='rule-swatch' style={{ background: rule.color || labelColor(rule.name) }} />
            <span className='rule-name' title={rule.description || rule.name}>{rule.name}</span>
          </div>
          <div className='rule-meta'>
            <Chip>LHS {rule.lhs.nodes.length}n/{rule.lhs.edges.length}e</Chip>
            <Chip>RHS {rule.rhs.nodes.length}n/{rule.rhs.edges.length}e</Chip>
            {rule.probability < 1 && <Chip>p={rule.probability}</Chip>}
            {rule.weight !== 1 && <Chip>w={rule.weight}</Chip>}
            {rule.priority !== 0 && <Chip>pri {rule.priority}</Chip>}
          </div>
        </div>
      </div>
      <div className='rule-controls'>
        <button className='icon-btn' title='Move up' onClick={(e) => { e.stopPropagation(); app.moveRule(rule.id, -1) }}><ChevronUp size={15} /></button>
        <button className='icon-btn' title='Move down' onClick={(e) => { e.stopPropagation(); app.moveRule(rule.id, 1) }}><ChevronDown size={15} /></button>
        <button className='icon-btn' title='Duplicate' onClick={(e) => { e.stopPropagation(); duplicate() }}><Copy size={14} /></button>
        <button className='icon-btn' title='Delete' onClick={(e) => { e.stopPropagation(); if (confirm(`Delete rule “${rule.name}”?`)) app.removeRule(rule.id) }}><X size={15} /></button>
      </div>
    </div>
  )
}
