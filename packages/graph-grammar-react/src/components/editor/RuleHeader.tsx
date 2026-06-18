import { useState } from 'react'
import type { Rule } from 'graph-grammar'
import { useApp } from '../../AppContext.tsx'
import { ComboBox } from '../ComboBox.tsx'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Distinct group names already used across the grammar's rules. */
function existingGroups (rules: Rule[]): string[] {
  const set = new Set<string>()
  for (const r of rules) if (r.group) set.add(r.group)
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Editable header for the active rule: name, colour, description, and the
 * run parameters (weight / probability / priority / max applications). Inputs
 * are uncontrolled (keyed by rule id at the call site) so editing the name
 * doesn't re-render the SVG on every keystroke; `touchRules()` propagates to
 * the rule list and match preview.
 */
export function RuleHeader ({ rule }: { rule: Rule }) {
  const app = useApp()
  const touch = () => app.touchRules()
  // Local mirror so the dropdown updates immediately (touchRules doesn't
  // re-render this header). Keyed by rule id at the call site, so it resets
  // when a different rule is opened.
  const [group, setGroup] = useState(rule.group ?? '')

  return (
    <div className='rule-header'>
      <div className='rh-top'>
        <input
          className='rule-name-input'
          defaultValue={rule.name}
          placeholder='Rule name'
          onChange={(e) => {
            rule.name = e.target.value
            touch()
          }}
        />
        <input
          type='color'
          className='rh-color'
          defaultValue={rule.color ?? '#7b5dcd'}
          title='Rule colour'
          onChange={(e) => {
            rule.color = e.target.value
            touch()
          }}
        />
      </div>
      <textarea
        className='rule-desc-input'
        rows={2}
        defaultValue={rule.description ?? ''}
        placeholder='Description , what does this rule do?'
        onChange={(e) => {
          rule.description = e.target.value
        }}
      />
      <label className='field inline rh-group'>
        <span className='field-label'>Group</span>
        <ComboBox
          className='rule-group-input'
          value={group}
          options={existingGroups(app.grammar.rules)}
          allowEmpty
          emptyLabel='(no group)'
          createLabel='Create new group…'
          placeholder='New group name…'
          onChange={(v) => {
            setGroup(v)
            rule.group = v || undefined
            touch()
          }}
        />
      </label>
      <div className='rh-params'>
        <label className='rh-param'>
          <span>weight</span>
          <input type='number' step={0.1} defaultValue={rule.weight} title='Selection bias in random strategy' onChange={(e) => { rule.weight = Number(e.target.value) || 0; touch() }} />
        </label>
        <label className='rh-param'>
          <span>prob</span>
          <input type='number' step={0.05} min={0} max={1} defaultValue={rule.probability} title='Chance a found match is applied (0–1)' onChange={(e) => { rule.probability = clamp01(Number(e.target.value)); touch() }} />
        </label>
        <label className='rh-param'>
          <span>priority</span>
          <input type='number' defaultValue={rule.priority} title='Higher fires first in priority strategy' onChange={(e) => { rule.priority = Number(e.target.value) || 0; touch() }} />
        </label>
        <label className='rh-param'>
          <span>max apps</span>
          <input type='number' min={0} defaultValue={rule.maxApplications} title='Cap on firings per run (0 = unlimited)' onChange={(e) => { rule.maxApplications = Number(e.target.value) || 0; touch() }} />
        </label>
      </div>
    </div>
  )
}
