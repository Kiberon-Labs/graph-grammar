import type { Grammar } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit, counter, copyProp } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 10. Quest Generator II , Branching paths + failure terminals. Builds on the
//     linear quest with two structures the literature treats as essential:
//
//     • OR-BRANCH (alternative approaches that rejoin). The quest must
//       "infiltrate" a Location. The generator forks a choice point with two
//       parallel routes that reconverge at an `inside` merge node:
//          loud  : assault → breach        (always available)
//          stealth: sneak → bypass(vent)   (ONLY if the structure allows it)
//       Crucially the stealth route is gated on a *graph connection*: it is
//       emitted only when the target Location has a `side_exit` edge to an Exit
//       node. Delete that edge from the start graph and the stealth branch is
//       never generated , availability is a property of the world topology, not
//       a dice roll (cf. Ashmore & Nitsche's lock-and-key world graphs).
//
//     • FAILURE / EARLY-RETURN TERMINALS. A quest is not just its success path;
//       the generator also wires in the ways it can go wrong, as dead-end `FAIL`
//       nodes hanging off the risky step that could trigger them:
//          assault → FAIL "alert raised"     (loud approach trips the alarm)
//          seize   → FAIL "item destroyed"   (the objective is fragile)
//          extract → FAIL "NPC killed"       (the rescue target can die)
//       These are deterministic and low-priority (NOT probabilistic): the engine
//       resolves a probability-gated high-priority rule as a wasted turn that
//       blocks lower rules, so a reliable "always include the failure branch"
//       is modelled as a capped, low-priority rule keyed off the risk element.
//
//     Frontier phases walk: travel → infiltrate → objective → rescue → return.
//     Read the assembled graph as a quest DAG: one spine, a diamond of parallel
//     approaches, a DONE terminal, and three FAIL terminals.
// ---------------------------------------------------------------------------
export function questBranching (): Grammar {
  const start = emptyGraph()

  const giver = makeNode('Giver', { name: 'Warlord', motivation: 'conquest' }, 120, 320)
  start.nodes.push(giver)

  // The target Location and its *structural* connections. The `side_exit` edge
  // is the fact that unlocks the stealth branch; the `guards` make it dangerous.
  const fort = makeNode('Location', { name: 'Stronghold' }, 560, 280)
  start.nodes.push(fort)
  const vent = makeNode('Exit', { name: 'Vent' }, 740, 170)
  start.nodes.push(vent)
  start.edges.push(makeEdge(fort.id, vent.id, 'side_exit', true)) // ← delete this to kill the stealth branch
  for (const [name, x, y] of [
    ['Sentry', 470, 150],
    ['Watchman', 700, 360],
  ] as Array<[string, number, number]>) {
    const guard = makeNode('Guard', { name }, x, y)
    start.nodes.push(guard)
    start.edges.push(makeEdge(fort.id, guard.id, 'guards', true))
  }

  // Objective facts inside the stronghold: a fragile Item and a rescuable NPC.
  const plans = makeNode('Item', { name: 'Plans' }, 650, 450)
  start.nodes.push(plans)
  start.edges.push(makeEdge(fort.id, plans.id, 'holds', true))
  const prisoner = makeNode('NPC', { name: 'Prisoner' }, 520, 470)
  start.nodes.push(prisoner)
  start.edges.push(makeEdge(fort.id, prisoner.id, 'holds', true))

  // -- 0. Accept the quest: open the frontier from the giver.
  const accept = rule({
    name: '0 · Accept infiltration quest',
    description: "The Giver opens a Quest frontier (phase 'travel') and the first 'accept' Step. Fires once.",
    color: '#f59f00',
    priority: 100,
    maxApplications: 1,
    lhs: { nodes: [pn('g', 'Giver')], edges: [] },
    rhs: {
      nodes: [
        rn('g', 'Giver', { mapFrom: 'g' }),
        rn('s', 'accept', { setProps: { n: counter() } }),
        rn('q', 'Quest', { setProps: { phase: lit('travel'), motivation: copyProp('g', 'motivation') } }),
      ],
      edges: [re('gv', 'g', 's', { label: 'gives', directed: true }), re('nx', 's', 'q', { label: 'next', directed: true })],
    },
  })

  // -- 1. Travel to the target Location (records its name onto a 'goto' Step).
  const approach = rule({
    name: '1 · Approach the target location',
    description: "Frontier in 'travel' walks to the Location, appending a 'goto' Step linked to it, then flips to 'infiltrate'.",
    color: '#4dabf7',
    priority: 85,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'travel' }] }),
        pn('loc', 'Location'),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('loc', 'Location', { mapFrom: 'loc' }),
        rn('g', 'goto', { setProps: { n: counter(), area: copyProp('loc', 'name') } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('infiltrate') } }),
      ],
      edges: [
        re('th', 's', 'g', { label: 'then', directed: true }),
        re('at', 'g', 'loc', { label: 'at', directed: true }),
        re('nx', 'g', 'q', { label: 'next', directed: true }),
      ],
    },
  })

  // -- 2. Fork the infiltration: a choice point + the LOUD route + the merge
  //       node both routes reconverge on. Frontier hops to the merge ('inside').
  const fork = rule({
    name: '2a · Infiltrate → fork (loud route)',
    description:
      "Splices an 'infiltrate' choice node with the always-available loud route (assault → breach) into a new 'inside' merge node, where the quest continues. The frontier moves to 'inside' and the phase becomes 'objective'.",
    color: '#fa5252',
    priority: 80,
    maxApplications: 1,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'infiltrate' }] }),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('b', 'infiltrate', { setProps: { n: counter() } }),
        rn('a', 'assault', { setProps: { n: counter() } }),
        rn('br', 'breach', { setProps: { n: counter() } }),
        rn('ins', 'inside', {}),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('objective') } }),
      ],
      edges: [
        re('th', 's', 'b', { label: 'then', directed: true }),
        re('loud', 'b', 'a', { label: 'loud', directed: true }),
        re('th2', 'a', 'br', { label: 'then', directed: true }),
        re('th3', 'br', 'ins', { label: 'then', directed: true }),
        re('nx', 'ins', 'q', { label: 'next', directed: true }),
      ],
    },
  })

  // -- 2b. The STEALTH route , emitted only when the world topology offers a side
  //        exit (Location --side_exit--> Exit). Attaches a parallel route to the
  //        existing choice node and merge. No frontier move: it's an alternative.
  const stealth = rule({
    name: '2b · Add stealth route (needs a side exit)',
    description:
      "If the target Location has a `side_exit` connection to an Exit, add a parallel stealth route (sneak → bypass) from the same 'infiltrate' choice node into the same 'inside' merge. Gated purely on the graph connection , no side_exit edge, no stealth option.",
    color: '#20c997',
    priority: 78,
    maxApplications: 1,
    lhs: {
      nodes: [
        pn('b', 'infiltrate'),
        pn('ins', 'inside'),
        pn('loc', 'Location'),
        pn('ex', 'Exit'),
      ],
      edges: [pe('se', 'loc', 'ex', { label: 'side_exit', directed: true })],
    },
    rhs: {
      nodes: [
        rn('b', 'infiltrate', { mapFrom: 'b' }),
        rn('ins', 'inside', { mapFrom: 'ins' }),
        rn('loc', 'Location', { mapFrom: 'loc' }),
        rn('ex', 'Exit', { mapFrom: 'ex' }),
        rn('sn', 'sneak', { setProps: { n: counter() } }),
        rn('by', 'bypass', { setProps: { n: counter(), via: copyProp('ex', 'name') } }),
      ],
      edges: [
        re('se', 'loc', 'ex', { label: 'side_exit', directed: true, mapFrom: 'se' }),
        re('stl', 'b', 'sn', { label: 'stealth', directed: true }),
        re('th', 'sn', 'by', { label: 'then', directed: true }),
        re('th2', 'by', 'ins', { label: 'then', directed: true }),
      ],
    },
  })

  // -- 3. Objective: seize the Item (consumes it). 3b skips if none remain.
  const seize = rule({
    name: '3 · Seize the objective item',
    description: "Inside the stronghold, append a 'seize' Step carrying the Item's name and CONSUME the Item fact. Phase → 'rescue'.",
    color: '#ffd43b',
    priority: 60,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'objective' }] }),
        pn('it', 'Item'),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('z', 'seize', { setProps: { n: counter(), loot: copyProp('it', 'name') } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('rescue') } }),
      ],
      edges: [re('th', 's', 'z', { label: 'then', directed: true }), re('nx', 'z', 'q', { label: 'next', directed: true })],
    },
    embedding: [emb('it', 'remove')],
  })
  const skipObjective = rule({
    name: '3b · No item → skip to rescue',
    description: "Fallback when no Item fact remains: just advance the phase to 'rescue'. Lower priority than the seize action.",
    color: '#868e96',
    priority: 58,
    lhs: { nodes: [pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'objective' }] })], edges: [] },
    rhs: { nodes: [rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('rescue') } })], edges: [] },
  })

  // -- 4. Rescue: extract the NPC (consumes it). 4b skips if none remain.
  const extract = rule({
    name: '4 · Extract the prisoner',
    description: "Append an 'extract' Step carrying the NPC's name and CONSUME the NPC fact. Phase → 'return'.",
    color: '#da77f2',
    priority: 55,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'rescue' }] }),
        pn('np', 'NPC'),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('x', 'extract', { setProps: { n: counter(), who: copyProp('np', 'name') } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('return') } }),
      ],
      edges: [re('th', 's', 'x', { label: 'then', directed: true }), re('nx', 'x', 'q', { label: 'next', directed: true })],
    },
    embedding: [emb('np', 'remove')],
  })
  const skipRescue = rule({
    name: '4b · No NPC → skip to return',
    description: "Fallback when no NPC fact remains: advance the phase to 'return'.",
    color: '#868e96',
    priority: 50,
    lhs: { nodes: [pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'rescue' }] })], edges: [] },
    rhs: { nodes: [rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('return') } })], edges: [] },
  })

  // -- 5. Return: report to the giver, mark the quest DONE, dissolve the frontier.
  const returnHome = rule({
    name: '5 · Exfil & report (quest complete)',
    description: "Append 'report' linked back to the Giver and a DONE terminal, then DELETE the Quest frontier so generation halts.",
    color: '#37b24d',
    priority: 30,
    lhs: {
      nodes: [pn('g', 'Giver'), pn('s', '*', { wildcard: true }), pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'return' }] })],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('g', 'Giver', { mapFrom: 'g' }),
        rn('s', '*', { mapFrom: 's' }),
        rn('r', 'report', { setProps: { n: counter() } }),
        rn('done', 'DONE', {}),
      ],
      edges: [
        re('th', 's', 'r', { label: 'then', directed: true }),
        re('dl', 'r', 'g', { label: 'delivers', directed: true }),
        re('end', 'r', 'done', { label: 'then', directed: true }),
      ],
    },
    embedding: [emb('q', 'remove')],
  })

  // -- Failure terminals. Deterministic, capped, and LOWER priority than every
  //    progression rule, so the success spine builds first and each failure
  //    branch is wired onto its risk step exactly once afterwards.
  function failure (name: string, stepLabel: string, reason: string, desc: string): ReturnType<typeof rule> {
    return rule({
      name,
      description: desc,
      color: '#e03131',
      priority: 25,
      maxApplications: 1,
      lhs: { nodes: [pn('s', stepLabel)], edges: [] },
      rhs: {
        nodes: [rn('s', stepLabel, { mapFrom: 's' }), rn('f', 'FAIL', { setProps: { reason: lit(reason) } })],
        edges: [re('risk', 's', 'f', { label: 'risk', directed: true })],
      },
    })
  }
  const failAlert = failure(
    'F1 · Alert raised (loud route)',
    'assault',
    'alert raised',
    "The loud assault can trip the alarm: wire a FAIL 'alert raised' terminal onto the 'assault' Step."
  )
  const failItem = failure(
    'F2 · Item destroyed',
    'seize',
    'item destroyed',
    "The objective is fragile: wire a FAIL 'item destroyed' terminal onto the 'seize' Step."
  )
  const failNpc = failure(
    'F3 · NPC killed',
    'extract',
    'NPC killed',
    "The rescue target can die: wire a FAIL 'NPC killed' terminal onto the 'extract' Step."
  )

  return grammar(
    '08 · Quest Generator II (branching + failure)',
    [accept, approach, fork, stealth, seize, skipObjective, extract, skipRescue, returnHome, failAlert, failItem, failNpc],
    start,
    { strategy: 'priority', maxSteps: -1, maxNodes: 80, seed: 5 }
  )
}
