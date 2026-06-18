import { useEffect, useRef, useState } from 'react'
import { Play, Pause, StepForward, FastForward, RotateCcw, Zap, Wand2 } from 'lucide-react'
import { plan, hasNodeLabeled } from 'graph-grammar'
import { useAppEvent } from '../../AppContext.tsx'
import { flash } from '../../toast.ts'

/** Play / pause / step / burst / reset + speed, the Turbo benchmark, and the
 *  backtracking planner (for grammars with a Goal node carrying a `want`). */
export function RunControls () {
  const app = useAppEvent('running', 'grammar')
  const timer = useRef(0)
  const planTimer = useRef(0)

  const stopPlay = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = 0
    if (planTimer.current) clearInterval(planTimer.current)
    planTimer.current = 0
    if (app.running) {
      app.running = false
      app.emit('running')
    }
  }
  const startPlay = () => {
    app.running = true
    app.emit('running')
    restartTimer()
  }
  const restartTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      const cfg = app.grammar.config
      // honour the step cap before stepping so we never overshoot it. The node
      // cap is enforced per-rule by the engine (growing rules are skipped at the
      // cap while net-zero rules still resolve), so Play stops naturally at the
      // fixpoint rather than freezing the moment maxNodes is reached.
      if (cfg.maxSteps > 0 && app.engine.steps >= cfg.maxSteps) {
        stopPlay()
        return
      }
      const r = app.step()
      if (!r.applied && !r.ruleId) stopPlay()
    }, 1000 / app.speed)
  }

  useEffect(() => () => stopPlay(), []) // cleanup on unmount

  const burst = (n: number) => {
    for (let i = 0; i < n; i++) app.engine.step()
    app.lastHighlight = null
    app.emit('graph')
  }
  const runToEnd = () => {
    stopPlay()
    const applied = app.engine.run()
    app.lastHighlight = null
    app.emit('graph')
    flash(`Applied ${applied} steps`)
  }
  const turbo = () => {
    stopPlay()
    const eng = app.engine
    eng.reset()
    const t0 = performance.now()
    let steps = 0
    let stop = false
    while (!stop && performance.now() - t0 < 1200) {
      for (let i = 0; i < 2000; i++) {
        const r = eng.step()
        if (r.applied) steps++
        else if (!r.ruleId) {
          stop = true
          break
        }
      }
    }
    const dt = performance.now() - t0
    app.lastHighlight = null
    app.emit('graph')
    flash(`⚡ ${steps.toLocaleString()} steps in ${dt.toFixed(0)} ms → ${Math.round(steps / (dt / 1000)).toLocaleString()} steps/s · ${eng.index.nodes.size.toLocaleString()} nodes`)
  }

  // The goal lives on a Goal node carrying a `want` (and optionally a comma-list
  // of `options` the user can pick from). `target` is the dish to plan for.
  const goalNode = app.grammar.start.nodes.find((n) => typeof n.props?.want === 'string')
  const defaultWant = goalNode ? String(goalNode.props.want) : null
  const goalOptions =
    goalNode && typeof goalNode.props.options === 'string'
      ? goalNode.props.options.split(',').map((s) => s.trim()).filter(Boolean)
      : null
  const [target, setTarget] = useState<string | null>(defaultWant)
  // re-init the chosen dish when a different example is loaded
  useEffect(() => setTarget(defaultWant), [app.grammar]) // eslint-disable-line react-hooks/exhaustive-deps
  const effTarget = target ?? defaultWant

  // Backtracking planner: search for a plan to the chosen goal and replay it on
  // the canvas , the visible counterpart to the greedy "Run to end".
  const findPlan = () => {
    if (!effTarget) return
    stopPlay()
    app.resetGraph()
    const result = plan(app.grammar, hasNodeLabeled(effTarget), { maxStates: 80000 })
    if (!result.found) {
      flash(`No plan found for “${effTarget}” , unreachable from these ingredients (explored ${result.statesExplored} states)`)
      return
    }
    flash(`Found a ${result.steps.length}-step plan for “${effTarget}” (explored ${result.statesExplored} states) , replaying`)
    const frames = result.frames
    let i = 1 // frame 0 is the start (already shown after reset)
    planTimer.current = window.setInterval(() => {
      if (i >= frames.length) {
        if (planTimer.current) clearInterval(planTimer.current)
        planTimer.current = 0
        return
      }
      const prev = frames[i - 1]
      const cur = frames[i]
      const prevIds = new Set([...prev.nodes.map((n) => n.id), ...prev.edges.map((e) => e.id)])
      const curIds = new Set([...cur.nodes.map((n) => n.id), ...cur.edges.map((e) => e.id)])
      app.engine.index.load(cur)
      app.lastHighlight = {
        created: new Set([...curIds].filter((id) => !prevIds.has(id))),
        deleted: new Set([...prevIds].filter((id) => !curIds.has(id))),
      }
      app.emit('graph')
      i++
    }, 700)
  }

  return (
    <section className='panel-section'>
      <h3>Run</h3>
      <div className='btn-row'>
        <button className='primary' onClick={() => (app.running ? stopPlay() : startPlay())}>
          {app.running ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
        </button>
        <button className='ghost' onClick={() => app.step()}><StepForward size={14} /> Step</button>
        <button className='ghost' onClick={() => burst(25)}><FastForward size={14} /> ×25</button>
        <button className='ghost' onClick={() => { stopPlay(); app.resetGraph() }}><RotateCcw size={14} /> Reset</button>
      </div>
      <label className='field inline'>
        <span className='field-label'>Speed</span>
        <input
          type='range'
          min={1}
          max={60}
          defaultValue={app.speed}
          onChange={(e) => {
            app.speed = Number(e.target.value)
            if (app.running) restartTimer()
          }}
        />
      </label>
      <div className='btn-row'>
        <button className='ghost small' onClick={runToEnd}>Run to end</button>
        <button className='ghost small' title='Run the current grammar flat-out and report steps/sec' onClick={turbo}><Zap size={13} /> Turbo bench</button>
        <button className='ghost small' title='Use the current graph as the new starting axiom' onClick={() => app.pinCurrentAsStart()}>Pin as start</button>
      </div>
      {effTarget && (
        <div className='btn-row plan-row'>
          {goalOptions && (
            <label className='field inline goal-pick' title='Choose the dish to plan for'>
              <span className='field-label'>Goal</span>
              <select value={effTarget} onChange={(e) => setTarget(e.target.value)}>
                {(goalOptions.includes(effTarget) ? goalOptions : [effTarget, ...goalOptions]).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          )}
          <button
            className='primary small plan-btn'
            title={`Backtracking search for a plan that makes “${effTarget}”, then replay it , compare with the greedy “Run to end”.`}
            onClick={findPlan}
          >
            <Wand2 size={13} /> Find plan → {effTarget}
          </button>
        </div>
      )}
    </section>
  )
}
