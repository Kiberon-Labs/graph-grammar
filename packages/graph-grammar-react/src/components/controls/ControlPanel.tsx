import { RunControls } from './RunControls.tsx'
import { StrategyConfig } from './StrategyConfig.tsx'
import { Stats } from './Stats.tsx'

/**
 * Left rail: the live run controls, strategy, and stats. Save/load mechanics
 * (import/export, presets, examples) moved to the header menu bar (<MenuBar>),
 * so this rail stays short and focused on driving a run.
 */
export function ControlPanel () {
  return (
    <div className='control-panel'>
      <RunControls />
      <StrategyConfig />
      <Stats />
    </div>
  )
}
