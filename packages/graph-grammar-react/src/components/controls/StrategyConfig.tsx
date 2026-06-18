import type { ApplicationStrategy } from 'graph-grammar'
import { useAppEvent } from '../../AppContext.tsx'

const STRATEGIES: { v: ApplicationStrategy; label: string }[] = [
  { v: 'random', label: 'Random (weighted)' },
  { v: 'priority', label: 'Priority order' },
  { v: 'sequential', label: 'Sequential (round-robin)' },
  { v: 'maximal', label: 'Maximal (parallel)' },
]

export function StrategyConfig () {
  const app = useAppEvent('config')
  const cfg = app.grammar.config

  return (
    <section className='panel-section'>
      <h3>Strategy</h3>
      <label className='field'>
        <span className='field-label'>Application</span>
        <select
          value={cfg.strategy}
          onChange={(e) => {
            cfg.strategy = e.target.value as ApplicationStrategy
            app.emit('config')
          }}
        >
          {STRATEGIES.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className='field-grid'>
        <label className='field'>
          <span className='field-label'>Seed</span>
          <input
            type='number'
            defaultValue={cfg.seed}
            onChange={(e) => {
              cfg.seed = Number(e.target.value) || 0
              app.engine.reset()
              app.emit('graph')
            }}
          />
        </label>
        <label className='field'>
          <span className='field-label'>Max steps</span>
          <input
            type='number'
            defaultValue={cfg.maxSteps}
            title='-1 = no cap'
            onChange={(e) => {
              const v = Number(e.target.value)
              cfg.maxSteps = Number.isFinite(v) ? v : -1
            }}
          />
        </label>
        <label className='field'>
          <span className='field-label'>Max nodes</span>
          <input type='number' defaultValue={cfg.maxNodes} title='0 = unlimited' onChange={(e) => (cfg.maxNodes = Number(e.target.value) || 0)} />
        </label>
      </div>
    </section>
  )
}
