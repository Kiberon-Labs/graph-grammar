import type { Grammar, Graph, Rule } from 'graph-grammar'
import { Engine } from 'graph-grammar'
import { cloneGraph } from 'graph-grammar'
import type { NodeStyleResolver } from './nodeStyle.ts'

export type AppEvent =
  | 'grammar' // grammar structure changed (rules added/removed/edited)
  | 'rules' // rule list changed
  | 'selectRule' // active rule selection changed
  | 'graph' // host graph changed (engine state)
  | 'config' // run config changed
  | 'running' // play/pause state changed
  | 'recenter' // request the graph view to re-frame/centre

type Listener = () => void

/**
 * A serializable capture of the authored state, used for undo/redo. Covers the
 * grammar (rules + config + start graph), the current host graph (canvas edits
 * live here until pinned), and the rule selection. Transient run state (play
 * timer, step counters, last-highlight) is deliberately excluded.
 */
export interface AppSnapshot {
  grammar: Grammar;
  graph: Graph;
  activeRuleId: string | null;
}

const bareGrammar = (): Grammar => ({
  id: 'unknown',
  name: 'Unknown',
  rules: [],
  config: {
    strategy: 'random',
    seed: 0,
    maxSteps: 100,
    maxNodes: 0
  },
  /** Starting graph (axiom). */
  start: {
    nodes: [],
    edges: []
  }
})

/**
 * Central, observable application state. Views subscribe to coarse-grained
 * events and re-read what they need. Keeps the no-framework UI coordinated.
 */
export class AppState {
  grammar: Grammar
  engine: Engine
  activeRuleId: string | null = null
  running = false
  speed = 6 // steps per second when playing
  /** highlight info from the last applied rewrite, for the graph view. */
  lastHighlight: { created: Set<string>; deleted: Set<string> } | null = null
  /** Optional per-node appearance override for the host graph canvas. The
   *  renderer reads this each frame; set it via `<Workbench nodeStyle={…}>`. */
  nodeStyle?: NodeStyleResolver

  /** Called after a tracked, undoable mutation with a short action label. The
   *  history layer (see history.ts) wires this to record a snapshot. */
  onCommit?: (label: string) => void
  /** Guards against recording history while we're applying an undo/redo. */
  private restoring = false

  private listeners = new Map<AppEvent, Set<Listener>>()

  constructor (grammar?: Grammar) {
    this.grammar = grammar ?? bareGrammar()
    this.engine = new Engine(this.grammar)
    this.activeRuleId = this.grammar.rules[0]?.id ?? null
  }

  on (ev: AppEvent, fn: Listener): () => void {
    let set = this.listeners.get(ev)
    if (!set) this.listeners.set(ev, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }

  emit (...evs: AppEvent[]) {
    for (const ev of evs) for (const fn of this.listeners.get(ev) ?? []) fn()
  }

  // ---- undo/redo support ----

  /** Announce a tracked, undoable change (no-op while restoring). */
  private commit (label: string) {
    if (!this.restoring) this.onCommit?.(label)
  }

  /** A structural host-graph edit from the canvas: refresh views AND record it.
   *  Distinct from `emit("graph")`, which run steps use and is NOT tracked. */
  commitGraph (label: string) {
    this.emit('graph')
    this.commit(label)
  }

  /** Capture the authored state for the history stack. */
  snapshot (): AppSnapshot {
    return {
      grammar: structuredClone(this.grammar),
      graph: cloneGraph(this.engine.graph),
      activeRuleId: this.activeRuleId,
    }
  }

  /** Restore a previously captured snapshot (undo/redo). Does not itself record. */
  restore (s: AppSnapshot) {
    this.restoring = true
    try {
      this.grammar = structuredClone(s.grammar)
      // Rebuild the engine on the restored grammar, then load the captured host
      // graph as the current state (the constructor clones it for us).
      this.engine = new Engine(this.grammar, s.graph)
      this.activeRuleId = this.grammar.rules.some((r) => r.id === s.activeRuleId)
        ? s.activeRuleId
        : (this.grammar.rules[0]?.id ?? null)
      this.running = false
      this.lastHighlight = null
      this.emit('grammar', 'rules', 'selectRule', 'graph', 'config', 'running', 'recenter')
    } finally {
      this.restoring = false
    }
  }

  // ---- grammar / engine lifecycle ----

  loadGrammar (g: Grammar, label = `Load “${g.name}”`) {
    this.grammar = g
    this.engine = new Engine(g)
    this.activeRuleId = g.rules[0]?.id ?? null
    this.running = false
    this.lastHighlight = null
    this.emit('grammar', 'rules', 'selectRule', 'graph', 'config', 'running', 'recenter')
    this.commit(label)
  }

  /** Reset the engine's host graph to the grammar's start (axiom). */
  resetGraph () {
    this.engine.reset()
    this.lastHighlight = null
    this.emit('graph', 'recenter')
  }

  /** Replace the start/axiom graph and reset. */
  setStartGraph (g: Graph, label = 'Set start graph') {
    this.grammar.start = g
    this.engine.reset(cloneGraph(g))
    this.lastHighlight = null
    this.emit('graph', 'recenter')
    this.commit(label)
  }

  /** Use the current host graph as the new axiom. */
  pinCurrentAsStart () {
    this.grammar.start = cloneGraph(this.engine.graph)
    this.emit('grammar')
    this.commit('Pin as start')
  }

  get activeRule (): Rule | null {
    return this.grammar.rules.find((r) => r.id === this.activeRuleId) ?? null
  }

  selectRule (id: string | null) {
    this.activeRuleId = id
    this.emit('selectRule')
  }

  addRule (r: Rule) {
    this.grammar.rules.push(r)
    this.activeRuleId = r.id
    this.emit('rules', 'selectRule', 'graph')
    this.commit('Add rule')
  }

  removeRule (id: string) {
    const i = this.grammar.rules.findIndex((r) => r.id === id)
    if (i < 0) return
    this.grammar.rules.splice(i, 1)
    if (this.activeRuleId === id) this.activeRuleId = this.grammar.rules[0]?.id ?? null
    this.emit('rules', 'selectRule', 'graph')
    this.commit('Delete rule')
  }

  moveRule (id: string, dir: -1 | 1) {
    const i = this.grammar.rules.findIndex((r) => r.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= this.grammar.rules.length) return
    const arr = this.grammar.rules;
    [arr[i], arr[j]] = [arr[j], arr[i]]
    this.emit('rules')
    this.commit('Reorder rules')
  }

  /** Called after editing a rule's internals so engine re-reads it. */
  touchRules (label = 'Edit rule') {
    this.emit('rules', 'graph')
    this.commit(label)
  }

  step () {
    const r = this.engine.step()
    if (r.applied) {
      this.lastHighlight = {
        created: new Set([...r.createdNodes, ...r.createdEdges]),
        deleted: new Set([...r.deletedNodes, ...r.deletedEdges]),
      }
    }
    this.emit('graph')
    return r
  }
}
