import type { Grammar, Rule, Match, Graph, RewriteResult } from './types.ts'
import { GraphIndex, cloneGraph } from './graph.ts'
import { findMatches, findOneMatch, hasMatch, countMatches } from './match.ts'
import { applyRule, type RewriteContext } from './rewrite.ts'
import { RNG } from './util.ts'

// ============================================================================
// The grammar engine. Drives application of a rule set to a host graph under a
// chosen strategy, with reproducible stochastic behaviour.
//
// Performance contract: a single rewrite step costs O(match-find), independent
// of the total number of matches in the graph. We never materialise the whole
// graph per step and we never enumerate the full match set just to apply one
// (single-match strategies use a randomised first-match search instead).
// ============================================================================

const EMPTY_RESULT: () => RewriteResult = () => ({
  applied: false,
  createdNodes: [],
  createdEdges: [],
  deletedNodes: [],
  deletedEdges: [],
})

export class Engine {
  index: GraphIndex
  grammar: Grammar
  ctx: RewriteContext
  steps = 0
  private appCount = new Map<string, number>()
  private seqPtr = 0

  constructor (grammar: Grammar, start?: Graph) {
    this.grammar = grammar
    // Clone so the engine never mutates the grammar's start/axiom in place ,
    // rewrites relabel and delete nodes, and the start must survive a reset.
    this.index = new GraphIndex(cloneGraph(start ?? grammar.start))
    this.ctx = { rng: new RNG(grammar.config.seed), counter: { value: 0 } }
  }

  reset (start?: Graph) {
    this.index = new GraphIndex(cloneGraph(start ?? this.grammar.start))
    this.ctx = { rng: new RNG(this.grammar.config.seed), counter: { value: 0 } }
    this.steps = 0
    this.appCount.clear()
    this.seqPtr = 0
  }

  get graph (): Graph {
    return this.index.toGraph()
  }

  private enabledRules (): Rule[] {
    return this.grammar.rules.filter(
      (r) =>
        r.enabled &&
        r.lhs.nodes.length > 0 &&
        (r.maxApplications === 0 || (this.appCount.get(r.id) ?? 0) < r.maxApplications) &&
        this.fitsNodeBudget(r)
    )
  }

  /** Net change in node count if this rule fires once: created − deleted. */
  nodeDelta (rule: Rule): number {
    const preserved = new Set(rule.rhs.nodes.map((n) => n.mapFrom).filter(Boolean) as string[])
    const created = rule.rhs.nodes.filter((n) => !n.mapFrom).length
    const deleted = rule.lhs.nodes.filter((n) => !preserved.has(n.id)).length
    return created - deleted
  }

  /** Would applying this rule keep the graph within maxNodes? Net-zero and
   *  shrinking rules always fit, so generation can still resolve at the cap. */
  fitsNodeBudget (rule: Rule): boolean {
    const cap = this.grammar.config.maxNodes
    return cap <= 0 || this.index.nodes.size + this.nodeDelta(rule) <= cap
  }

  /** True if the rule would grow past maxNodes (used by the UI to show why a
   *  matching rule can't currently fire). */
  isBlockedByNodeCap (rule: Rule): boolean {
    const cap = this.grammar.config.maxNodes
    return cap > 0 && this.index.nodes.size + this.nodeDelta(rule) > cap
  }

  /** Global-form NAC: block the rule if any NAC pattern exists in the host. */
  private nacBlocked (rule: Rule): boolean {
    if (!rule.nac || rule.nac.length === 0) return false
    for (const nac of rule.nac) if (nac.nodes.length && hasMatch(nac, this.index)) return true
    return false
  }

  /** A single random match for a rule (NAC-aware), or null. */
  private oneMatch (rule: Rule): Match | null {
    if (this.nacBlocked(rule)) return null
    return findOneMatch(rule.id, rule.lhs, this.index, this.ctx.rng)
  }

  step (): RewriteResult {
    const cfg = this.grammar.config
    // No blanket node-cap gate here: rules that would grow past maxNodes are
    // excluded by enabledRules()/fitsNodeBudget(), while net-zero / shrinking
    // rules still fire so generation can resolve at the cap.

    if (cfg.strategy === 'maximal') {
      const rule = this.pickMaximalRule()
      return rule ? this.applyMaximal(rule) : EMPTY_RESULT()
    }

    // Find a (rule, match) pair in one pass , no separate applicability probe.
    const picked = this.pickRuleAndMatch()
    if (!picked) return EMPTY_RESULT()
    const { rule, match: m } = picked

    // probability gate: counts as a (no-op) step, lets the run loop try again
    if (rule.probability < 1 && this.ctx.rng.next() > rule.probability) {
      const r = EMPTY_RESULT()
      r.ruleId = rule.id
      return r
    }

    const changes = applyRule(this.index, rule, m, this.ctx)
    this.appCount.set(rule.id, (this.appCount.get(rule.id) ?? 0) + 1)
    this.steps++
    return { applied: true, ruleId: rule.id, match: m, ...changes }
  }

  /**
   * Select a rule AND one of its matches together, so we pay for at most one
   * match search per rule tried (and usually exactly one for the whole step).
   */
  private pickRuleAndMatch (): { rule: Rule; match: Match } | null {
    const rules = this.enabledRules()
    if (rules.length === 0) return null
    const cfg = this.grammar.config

    if (cfg.strategy === 'priority') {
      const sorted = [...rules].sort((a, b) => b.priority - a.priority)
      for (const r of sorted) {
        const m = this.oneMatch(r)
        if (m) return { rule: r, match: m }
      }
      return null
    }
    if (cfg.strategy === 'sequential') {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[(this.seqPtr + i) % rules.length]
        const m = this.oneMatch(r)
        if (m) {
          this.seqPtr = (this.seqPtr + i + 1) % rules.length
          return { rule: r, match: m }
        }
      }
      return null
    }
    // random: draw rules in weight-biased order; first one that matches wins.
    // This is a weighted random choice among the *applicable* rules without
    // probing every rule up front.
    const pool = rules.slice()
    const weights = pool.map((r) => r.weight)
    while (pool.length) {
      const idx = this.ctx.rng.weightedIndex(weights)
      const r = pool[idx]
      const m = this.oneMatch(r)
      if (m) return { rule: r, match: m }
      pool.splice(idx, 1)
      weights.splice(idx, 1)
    }
    return null
  }

  /** For the maximal strategy: weighted pick among rules that currently match. */
  private pickMaximalRule (): Rule | null {
    const rules = this.enabledRules().filter(
      (r) => !this.nacBlocked(r) && findMatches(r.id, r.lhs, this.index, { limit: 1 }).length > 0
    )
    if (!rules.length) return null
    const idx = this.ctx.rng.weightedIndex(rules.map((r) => r.weight))
    return rules[idx]
  }

  /** Apply as many non-overlapping matches of one rule as possible this step. */
  private applyMaximal (rule: Rule): RewriteResult {
    const matches = findMatches(rule.id, rule.lhs, this.index)
    if (!matches.length) return EMPTY_RESULT()
    this.ctx.rng.shuffle(matches)
    const used = new Set<string>()
    const agg = EMPTY_RESULT()
    let count = 0
    let firstMatch: Match | undefined
    for (const m of matches) {
      const nodes = Object.values(m.nodeMap)
      if (nodes.some((n) => used.has(n))) continue
      if (rule.probability < 1 && this.ctx.rng.next() > rule.probability) continue
      if (rule.maxApplications && (this.appCount.get(rule.id) ?? 0) >= rule.maxApplications) break
      if (!this.fitsNodeBudget(rule)) break // stop before exceeding maxNodes
      const changes = applyRule(this.index, rule, m, this.ctx)
      for (const n of nodes) used.add(n)
      agg.createdNodes.push(...changes.createdNodes)
      agg.createdEdges.push(...changes.createdEdges)
      agg.deletedNodes.push(...changes.deletedNodes)
      agg.deletedEdges.push(...changes.deletedEdges)
      this.appCount.set(rule.id, (this.appCount.get(rule.id) ?? 0) + 1)
      if (!firstMatch) firstMatch = m
      count++
    }
    if (count) this.steps++
    agg.applied = count > 0
    agg.ruleId = rule.id
    agg.match = firstMatch
    return agg
  }

  /**
   * Run repeatedly until no rule applies or a bound is hit. Returns the number
   * of applied steps. The optional callback observes progress (don't pass one
   * for max throughput , it forces work per step).
   */
  run (maxSteps?: number, onStep?: (r: RewriteResult, i: number) => void): number {
    const cfg = this.grammar.config
    const requested = maxSteps ?? cfg.maxSteps
    // maxSteps <= 0 means "no step cap". For this synchronous path we still keep
    // a hard safety bound so an unbounded grammar can't freeze the page , when a
    // node cap is set the loop is bounded by that instead.
    // Uncapped runs keep a hard safety bound so the synchronous loop can't hang;
    // maxNodes is enforced per-rule by fitsNodeBudget, so the run naturally stops
    // once only non-growing rules remain and they reach a fixpoint.
    const cap = requested > 0 ? requested : 500_000
    let applied = 0
    let emptyStreak = 0
    for (let i = 0; i < cap; i++) {
      const r = this.step()
      if (!r.applied) {
        // probability skips return a ruleId; allow a bounded number of retries
        if (r.ruleId && emptyStreak < 64) {
          emptyStreak++
          onStep?.(r, i)
          continue
        }
        break
      }
      emptyStreak = 0
      applied++
      onStep?.(r, i)
    }
    return applied
  }

  /**
   * Match counts for the UI badges, each capped so a huge graph can't stall the
   * render loop. Returns the count or `cap` (caller renders "cap+").
   */
  matchCounts (cap = 200): Record<string, number> {
    const out: Record<string, number> = {}
    for (const r of this.grammar.rules) {
      if (!r.enabled || r.lhs.nodes.length === 0 || this.nacBlocked(r)) {
        out[r.id] = 0
        continue
      }
      out[r.id] = countMatches(r.lhs, this.index, cap)
    }
    return out
  }
}
