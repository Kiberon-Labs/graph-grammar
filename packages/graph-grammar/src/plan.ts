import type { Grammar, Graph } from './types.ts'
import { GraphIndex, cloneGraph } from './graph.ts'
import { findMatches, hasMatch } from './match.ts'
import { applyRule, type RewriteContext } from './rewrite.ts'
import { RNG } from './util.ts'

// ============================================================================
// Backtracking planner.
//
// The Engine applies rules *forward and greedily* , each step commits to one
// rewrite and never undoes it. That's the right model for simulation and for
// generative grammars, but as a planner it is incomplete: if reaching a goal
// requires *not* taking an action that's currently applicable (e.g. don't spend
// the only flour on bread when you wanted cake), a greedy run can paint itself
// into a corner and fail even though a plan exists.
//
// `plan()` treats the very same rules as a state-transition relation and runs a
// depth-first search with backtracking: try a rule, recurse, and on a dead end
// *undo* and try the next option. It explores rules in priority order, so the
// first branch it tries mirrors what the greedy `priority` strategy would do ,
// which makes it easy to show "greedy fails here, backtracking succeeds". The
// rules are unchanged; only the control strategy differs.
// ============================================================================

export interface PlanStep {
  ruleId: string;
  ruleName: string;
}

export interface PlanResult {
  /** Whether a goal state was reached. */
  found: boolean;
  /** The action sequence from the start to the goal (empty if not found). */
  steps: PlanStep[];
  /** The goal-state graph if found, else the start graph. */
  graph: Graph;
  /** The graphs along the winning path: `[start, …, goal]` , one more than
   *  `steps`. Lets a UI replay the plan frame by frame. Empty if not found. */
  frames: Graph[];
  /** How many rewrites the search tried (a measure of effort / branching). */
  statesExplored: number;
}

export interface PlanOptions {
  /** Maximum plan length to consider. */
  maxDepth?: number;
  /** Hard cap on rewrites attempted, so an unsolvable problem still terminates. */
  maxStates?: number;
}

/** An id-agnostic key used only to detect cycles on the current search path (so
 *  cyclic rules can't loop forever). Includes node props, because in fact-based
 *  domains the state lives in the props (counts/money), not the labels , so a
 *  rewrite that only changes a number must read as a *different* state. */
function stateKey (g: Graph): string {
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label] as const))
  const propsOf = (p: Record<string, unknown>) =>
    Object.keys(p).length === 0 ? '' : JSON.stringify(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)))
  const nodes = g.nodes.map((n) => n.label + propsOf(n.props)).sort()
  const edges = g.edges.map((e) => `${labelOf.get(e.source)}-${e.label}>${labelOf.get(e.target)}`).sort()
  return `${g.nodes.length};${nodes.join(',')}|${edges.join(',')}`
}

/**
 * Iterative-deepening DFS (with backtracking) for a state satisfying
 * `goalReached`. Returns the SHORTEST action sequence and the goal-state graph,
 * or `found: false` if no plan exists within the bounds. Pure: never mutates
 * `grammar` or its start.
 */
export function plan (
  grammar: Grammar,
  goalReached: (g: Graph) => boolean,
  opts: PlanOptions = {}
): PlanResult {
  const maxDepth = opts.maxDepth ?? 32
  const maxStates = opts.maxStates ?? 20000
  // Higher priority first → the first branch explored matches greedy `priority`.
  const rules = grammar.rules
    .filter((r) => r.enabled && r.lhs.nodes.length > 0)
    .sort((a, b) => b.priority - a.priority)
  const ctx: RewriteContext = { rng: new RNG(grammar.config.seed), counter: { value: 0 } }
  let statesExplored = 0

  // Iterative deepening: depth-limited DFS at limits 0,1,2,… returns the first ,
  // i.e. SHORTEST , plan, so a replay never includes a wasted detour. Re-running
  // shallow levels is cheap for the small plans these domains produce.
  for (let limit = 0; limit <= maxDepth; limit++) {
    const onPath = new Set<string>()
    const path: PlanStep[] = []
    const pathGraphs: Graph[] = [] // winning-path graphs, parallel to `path`

    const startGraph = cloneGraph(grammar.start)
    const dfs = (graph: Graph, depth: number): Graph | null => {
      if (goalReached(graph)) return graph
      if (depth >= limit || statesExplored >= maxStates) return null
      const key = stateKey(graph)
      if (onPath.has(key)) return null // cycle on this branch
      onPath.add(key)

      const index = new GraphIndex(graph)
      for (const rule of rules) {
        // Respect negative application conditions, exactly like the Engine.
        if (rule.nac && rule.nac.some((n) => n.nodes.length > 0 && hasMatch(n, index))) continue
        for (const match of findMatches(rule.id, rule.lhs, index)) {
          if (statesExplored >= maxStates) break
          statesExplored++
          // Apply to a *clone* so siblings are unaffected. cloneGraph preserves
          // ids, so the match (found on `graph`) is valid on the clone.
          const clone = cloneGraph(graph)
          const cloneIndex = new GraphIndex(clone)
          applyRule(cloneIndex, rule, match, ctx)
          const next = cloneIndex.toGraph()
          path.push({ ruleId: rule.id, ruleName: rule.name })
          pathGraphs.push(next)
          const goal = dfs(next, depth + 1)
          if (goal) return goal
          path.pop() // backtrack
          pathGraphs.pop()
        }
      }

      onPath.delete(key)
      return null
    }

    const goal = dfs(startGraph, 0)
    if (goal) {
      return { found: true, steps: [...path], graph: goal, frames: [startGraph, ...pathGraphs], statesExplored }
    }
    if (statesExplored >= maxStates) break // out of budget → give up
  }

  return { found: false, steps: [], graph: cloneGraph(grammar.start), frames: [], statesExplored }
}

/** Convenience goal test: a node with this label exists in the graph. */
export const hasNodeLabeled = (label: string) => (g: Graph) => g.nodes.some((n) => n.label === label)
