import { useAppEvent } from '../../AppContext.tsx'
import { graphStats } from 'graph-grammar'
import { labelColor } from '../../colors.ts'

export function Stats () {
  const app = useAppEvent('graph')
  const s = graphStats(app.engine.graph)
  return (
    <div className='stats'>
      <div className='stat-row'>
        <span className='stat big'>{s.nodes}</span>
        <span className='stat-label'>nodes</span>
        <span className='stat big'>{s.edges}</span>
        <span className='stat-label'>edges</span>
        <span className='stat big'>{app.engine.steps}</span>
        <span className='stat-label'>steps</span>
      </div>
      <div className='legend'>
        {s.labels.slice(0, 16).map(([label, n]) => (
          <span className='legend-item' key={label}>
            <span className='legend-dot' style={{ background: labelColor(label) }} />
            {label} {n}
          </span>
        ))}
      </div>
    </div>
  )
}
