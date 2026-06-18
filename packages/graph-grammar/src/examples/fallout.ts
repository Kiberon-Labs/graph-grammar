import type { Grammar, Graph } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'
import { FALLOUT_QUESTS, type QuestData, type QuestStageData } from './fallout-quests.ts'

// ---------------------------------------------------------------------------
// Fallout quests as quest chains. Real quest-stage data scraped from the
// Fallout wiki (the `va-queststages` tables, via the fallout-quest-scraper
// package) is MODELLED here as graphs:
//
//   • CHAIN. The obligatory stages, in ascending stage order, form the spine ,
//     a Quest "giver" node, then Stage → Stage → … linked by `then` edges.
//   • OPTIONAL BRANCHING. Optional stages peel off the spine on an `optional`
//     edge, chain among themselves, and `rejoin` the next mandatory stage (or a
//     terminal) , a side route that runs parallel to the main line, exactly the
//     shape the quest design literature calls an OR-branch.
//   • TERMINALS. A stage flagged "Quest finished" becomes a success terminal
//     (`End`); a "Quest failed" stage becomes a failure terminal (`Fail`).
//     Several terminals can hang off the same mandatory stage , that's a quest
//     with multiple endings (e.g. Veni, Vidi, Vici: "driven off" vs "killed").
//
// `questToGraph()` is the pure converter; `build()` lays the five bundled
// quests out as separate chains and adds a tiny "playthrough" grammar , a Token
// that walks each chain from its giver, picking a branch at each fork and
// halting at whichever terminal it reaches. Run it to watch the chains resolve.
// ---------------------------------------------------------------------------

// Re-derive the structural role of a stage from the scraped flags + text, so
// the model is robust even where the scraper's own flagging is conservative
// (e.g. it tags "(Optional)" but not the rarer "[Optional]" bracket form).
const isOptional = (s: QuestStageData): boolean =>
  s.optional || /^\s*[([]\s*optional\s*[)\]]/i.test(s.description)
const isFail = (s: QuestStageData): boolean =>
  !s.finished && /\bquest failed\b|^\s*failed\b|\bfailed\.?$/i.test(s.description)
const stageRole = (s: QuestStageData): 'End' | 'Fail' | 'Optional' | 'Stage' =>
  s.finished ? 'End' : isFail(s) ? 'Fail' : isOptional(s) ? 'Optional' : 'Stage'

const COL = 165 // horizontal gap between successive nodes
const OPT_DY = -118 // optional lane sits above the spine
const TERM_DY = 82 // terminals fan out below the spine

/**
 * Append one quest, modelled as a chain, to `g` with its giver node at
 * (x0, y0). Returns nothing; mutates `g`. Optional stages branch above the
 * spine and rejoin; finished/failed stages become terminals fanning out below.
 */
export function appendQuestChain (g: Graph, quest: QuestData, x0: number, y0: number): void {
  const props = (s: QuestStageData) => ({ n: s.stage, text: s.description, status: s.status })
  const stages = [...quest.stages].sort((a, b) => a.stage - b.stage)

  const start = makeNode('Quest', { title: quest.title, game: quest.game, url: quest.url }, x0, y0)
  g.nodes.push(start)

  let prevMain = start // last node on the spine
  let optTail: ReturnType<typeof makeNode> | null = null // tail of the active optional run
  let termN = 0 // terminals attached to the current prevMain (for vertical fan-out)

  for (const s of stages) {
    const role = stageRole(s)
    if (role === 'Optional') {
      const anchor = optTail ?? prevMain
      const node = makeNode('Optional', props(s), anchor.x! + COL, y0 + OPT_DY)
      g.nodes.push(node)
      g.edges.push(makeEdge(anchor.id, node.id, optTail ? 'then' : 'optional', true))
      optTail = node
    } else if (role === 'End' || role === 'Fail') {
      const node = makeNode(role, props(s), prevMain.x! + COL, y0 + TERM_DY + termN * 64)
      termN++
      g.nodes.push(node)
      g.edges.push(makeEdge(prevMain.id, node.id, 'then', true))
      if (optTail) {
        g.edges.push(makeEdge(optTail.id, node.id, 'rejoin', true))
        optTail = null
      }
    } else {
      const node = makeNode('Stage', props(s), prevMain.x! + COL, y0)
      g.nodes.push(node)
      g.edges.push(makeEdge(prevMain.id, node.id, 'then', true))
      if (optTail) {
        g.edges.push(makeEdge(optTail.id, node.id, 'rejoin', true))
        optTail = null
      }
      prevMain = node
      termN = 0
    }
  }
  // A trailing optional run with nothing after it rejoins the last spine node.
  if (optTail) g.edges.push(makeEdge(optTail.id, prevMain.id, 'rejoin', true))
}

/** Build the standalone chain graph for a single quest (giver at the origin). */
export function questToGraph (quest: QuestData): Graph {
  const g = emptyGraph()
  appendQuestChain(g, quest, 60, 160)
  return g
}

export function falloutQuests (): Grammar {
  const start = emptyGraph()
  // Stack the bundled quests as independent chains (switch to the Dagre / ELK
  // layout in the canvas for clean left-to-right layering).
  FALLOUT_QUESTS.forEach((q, i) => appendQuestChain(start, q, 60, 150 + i * 250))

  // ----- a tiny playthrough grammar over the modelled chains ----------------
  // ● begin: drop a Token on each quest's giver (once).
  const begin = rule({
    name: '● Begin , drop a token on each quest',
    description: 'Place a walkthrough Token at each Quest giver node (fires once per quest).',
    color: '#7048e8',
    priority: 100,
    lhs: { nodes: [pn('q', 'Quest', { predicates: [{ key: 'started', op: 'absent' }] })], edges: [] },
    rhs: {
      nodes: [rn('q', 'Quest', { mapFrom: 'q', setProps: { started: lit(true) } }), rn('tok', 'Token', {})],
      edges: [re('at', 'tok', 'q', { label: 'at', directed: true })],
    },
  })

  // ▶ advance: the token follows ANY outgoing edge (then / optional / rejoin),
  //    marking the stage visited. At a fork (a stage with both a `then` and an
  //    `optional` edge) the engine picks one , that's the branch choice.
  const advance = rule({
    name: '▶ Advance along the chain',
    description: 'Move the Token along one outgoing edge to the next step, marking the current step visited. At a fork it takes either the main line or the optional branch.',
    color: '#4dabf7',
    lhs: {
      nodes: [pn('t', 'Token'), pn('x', '*', { wildcard: true }), pn('y', '*', { wildcard: true })],
      edges: [pe('at', 't', 'x', { label: 'at', directed: true }), pe('e', 'x', 'y', { directed: true })],
    },
    rhs: {
      nodes: [
        rn('t', 'Token', { mapFrom: 't' }),
        rn('x', '*', { mapFrom: 'x', setProps: { visited: lit(true) } }),
        rn('y', '*', { mapFrom: 'y' }),
      ],
      edges: [re('e', 'x', 'y', { directed: true, mapFrom: 'e' }), re('at2', 't', 'y', { label: 'at', directed: true })],
    },
  })

  // ✓ / ✗ terminals: the token has reached a leaf (no outgoing edge) , record
  //    the outcome on the terminal and consume the token so the run can halt.
  const reachEnd = rule({
    name: '✓ Reach a success terminal',
    description: 'The Token reaches an `End` terminal: mark it reached and consume the Token.',
    color: '#0ca678',
    lhs: { nodes: [pn('t', 'Token'), pn('x', 'End')], edges: [pe('at', 't', 'x', { label: 'at', directed: true })] },
    rhs: { nodes: [rn('x', 'End', { mapFrom: 'x', setProps: { reached: lit(true) } })], edges: [] },
    embedding: [emb('t', 'remove')],
  })
  const reachFail = rule({
    name: '✗ Reach a failure terminal',
    description: 'The Token reaches a `Fail` terminal: mark it and consume the Token.',
    color: '#e03131',
    lhs: { nodes: [pn('t', 'Token'), pn('x', 'Fail')], edges: [pe('at', 't', 'x', { label: 'at', directed: true })] },
    rhs: { nodes: [rn('x', 'Fail', { mapFrom: 'x', setProps: { reached: lit(true) } })], edges: [] },
    embedding: [emb('t', 'remove')],
  })

  return grammar(
    '★ Fallout: Quest Chains (scraped)',
    [begin, advance, reachEnd, reachFail],
    start,
    { strategy: 'random', maxSteps: -1, maxNodes: 200, seed: 4 }
  )
}
