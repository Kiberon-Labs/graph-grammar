import type { Grammar } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit, randInt, counter, copyProp, incProp } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 9. Quest Generator. A grammar that *consumes a pool of world facts* (areas,
//    foes, items seeded into the start graph) to grow a linear quest as a chain
//    of Step nodes. It is a small implementation of the three-tier model from
//    the procedural-quest literature (Doran & Parberry 2011; cf. Propp's
//    lack→liquidation, Aarseth's place/objective quests, Ashmore & Nitsche's
//    lock-and-key world graphs):
//
//        quest-giver motivation  →  strategy  →  atomic actions
//
//    • The GIVER carries a `motivation` (here "serenity" , revenge/recovery).
//      That desire selects which "core action" rule may fire (slay / fetch /
//      learn), so the same grammar yields a different quest per motivation.
//    • A single QUEST frontier node drives growth. It walks a tiny state
//      machine in its `phase` prop: travel → act → travel → … → return → done.
//      Each rule splices one new Step into the chain just behind the frontier
//      (the `next` pointer is rewired; permanent links become `then`).
//    • AREA selection is the priority list the design calls for: "travel to an
//      UNEXPLORED area" sits at higher priority than "travel to a known area",
//      so the engine always prefers an unexplored Area (marking it explored)
//      and only revisits a known one when no unexplored Area is left.
//    • FACTS are consumed: slaying deletes the Foe, a fetch would delete the
//      Item. Facts the motivation doesn't use (the leftover Item below) simply
//      remain in the pool , the generator only eats what the quest needs.
//    • `legs` (set at init) bounds the quest length and guarantees termination:
//      each travel spends a leg; when legs run out the frontier returns to the
//      giver and dissolves, so no rule can match and growth halts.
//
//    Run it on the `priority` strategy and step through to watch the quest
//    line assemble: accept → goto → kill → goto → kill → … → report.
// ---------------------------------------------------------------------------
export function questGenerator (): Grammar {
  const start = emptyGraph()

  // The quest-giver and their desire. Swap `motivation` to "wealth" / "knowledge"
  // to steer which core-action rule fires (see act-fetch / act-learn below).
  const giver = makeNode('Giver', { name: 'Elder', motivation: 'serenity' }, 140, 320)
  start.nodes.push(giver)

  // The fact pool: AREAS the quest can travel to. Three unexplored, two already
  // explored , fewer unexplored than the max `legs`, so the known-area fallback
  // is guaranteed to fire and you can see the priority list in action.
  const areas: Array<[string, string, number, number]> = [
    ['Forest', 'unexplored', 520, 110],
    ['Cave', 'unexplored', 670, 220],
    ['Ruins', 'unexplored', 640, 410],
    ['Village', 'explored', 500, 540],
    ['Crossroad', 'explored', 360, 170],
  ]
  for (const [name, state, x, y] of areas) {
    start.nodes.push(makeNode('Area', { name, state }, x, y))
  }

  // FOES the "serenity" motivation will consume (revenge), plus one leftover
  // ITEM the quest won't touch , proof the generator only eats relevant facts.
  for (const [name, x, y] of [
    ['Bandit', 560, 300],
    ['Wraith', 700, 360],
    ['Ogre', 600, 180],
    ['Shade', 470, 430],
  ] as Array<[string, number, number]>) {
    start.nodes.push(makeNode('Foe', { name }, x, y))
  }
  start.nodes.push(makeNode('Item', { name: 'Relic' }, 300, 470))

  // -- Phase 0: accept the quest. Fires once; spawns the frontier from the giver.
  const accept = rule({
    name: '0 · Accept quest from giver',
    description:
      "The Giver opens a Quest frontier, copying their motivation onto it and rolling 4–5 `legs` (the quest length). Lays the first Step ('accept'); the frontier trails it via a `next` pointer. Fires once.",
    color: '#f59f00',
    priority: 100,
    maxApplications: 1,
    lhs: { nodes: [pn('g', 'Giver')], edges: [] },
    rhs: {
      nodes: [
        rn('g', 'Giver', { mapFrom: 'g' }),
        rn('s', 'accept', { setProps: { n: counter() } }),
        rn('q', 'Quest', {
          setProps: { phase: lit('travel'), legs: randInt(4, 5), motivation: copyProp('g', 'motivation') },
        }),
      ],
      edges: [re('gv', 'g', 's', { label: 'gives', directed: true }), re('nx', 's', 'q', { label: 'next', directed: true })],
    },
  })

  // -- Travel, preferring unexplored areas. Both rules splice a `goto` Step in
  //    behind the frontier; the higher-priority unexplored variant wins whenever
  //    any unexplored Area remains. Each travel spends one `leg`.
  function travel (name: string, areaState: string, priority: number, color: string, desc: string): ReturnType<typeof rule> {
    return rule({
      name,
      description: desc,
      color,
      priority,
      lhs: {
        nodes: [
          pn('s', '*', { wildcard: true }),
          pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'travel' }, { key: 'legs', op: 'gt', value: 0 }] }),
          pn('a', 'Area', { predicates: [{ key: 'state', op: 'eq', value: areaState }] }),
        ],
        edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
      },
      rhs: {
        nodes: [
          rn('s', '*', { mapFrom: 's' }),
          rn('a', 'Area', { mapFrom: 'a', setProps: { state: lit('explored') } }),
          rn('g', 'goto', { setProps: { n: counter(), area: copyProp('a', 'name') } }),
          rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('act'), legs: incProp('q', 'legs', -1) } }),
        ],
        edges: [
          re('th', 's', 'g', { label: 'then', directed: true }),
          re('at', 'g', 'a', { label: 'at', directed: true }),
          re('nx', 'g', 'q', { label: 'next', directed: true }),
        ],
      },
    })
  }
  const travelUnexplored = travel(
    '1a · Travel to an UNEXPLORED area',
    'unexplored',
    60,
    '#4dabf7',
    "Frontier in `travel` phase walks to an Area whose state is 'unexplored', marks it 'explored', and appends a 'goto' Step. Higher priority than the known-area rule, so the quest always heads somewhere new first."
  )
  const travelKnown = travel(
    '1b · Travel to a known area (fallback)',
    'explored',
    50,
    '#748ffc',
    "Same as 1a but for an already-'explored' Area. Lower priority, so it only fires once no unexplored Area is left , this is the area-selection priority list."
  )

  // -- Core action, gated by the giver's motivation. "serenity" → slay a Foe
  //    (revenge). The Foe fact is consumed; the frontier returns to `travel`.
  const actSlay = rule({
    name: '2 · Slay a foe (serenity / conquest / protection)',
    description:
      "In the `act` phase, if the motivation calls for violence and a Foe fact exists, splice a 'kill' Step (carrying the foe's name) and DELETE the Foe , the fact is consumed. Frontier flips back to `travel` for the next leg.",
    color: '#fa5252',
    priority: 70,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', {
          predicates: [
            { key: 'phase', op: 'eq', value: 'act' },
            { key: 'motivation', op: 'in', value: ['serenity', 'conquest', 'protection'] },
          ],
        }),
        pn('f', 'Foe'),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('k', 'kill', { setProps: { n: counter(), target: copyProp('f', 'name') } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('travel') } }),
      ],
      edges: [re('th', 's', 'k', { label: 'then', directed: true }), re('nx', 'k', 'q', { label: 'next', directed: true })],
    },
    embedding: [emb('f', 'remove')],
  })

  // -- Alternative core actions for other motivations (inert for "serenity", but
  //    show how the same grammar branches on desire). Swap the giver's motivation
  //    to see these fire instead.
  const actFetch = rule({
    name: '2 · Fetch an item (wealth / reputation / ability)',
    description:
      "Acquisitive motivations consume an Item fact instead, appending a 'get' Step. Inert while the giver wants 'serenity'.",
    color: '#37b24d',
    priority: 70,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', {
          predicates: [
            { key: 'phase', op: 'eq', value: 'act' },
            { key: 'motivation', op: 'in', value: ['wealth', 'reputation', 'ability', 'comfort'] },
          ],
        }),
        pn('i', 'Item'),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('g', 'get', { setProps: { n: counter(), target: copyProp('i', 'name') } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('travel') } }),
      ],
      edges: [re('th', 's', 'g', { label: 'then', directed: true }), re('nx', 'g', 'q', { label: 'next', directed: true })],
    },
    embedding: [emb('i', 'remove')],
  })

  // -- Nothing to act on: lower priority than the core actions, so it only fires
  //    when no consumable fact remains. The hero searches but finds nothing.
  const actSearch = rule({
    name: '2z · Search (no fact to consume)',
    description:
      "Fallback for the `act` phase when no matching fact is left in the pool: append a 'search' Step and move on. Lower priority than the real actions.",
    color: '#868e96',
    priority: 40,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'act' }] }),
      ],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('x', 'search', { setProps: { n: counter() } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('travel') } }),
      ],
      edges: [re('th', 's', 'x', { label: 'then', directed: true }), re('nx', 'x', 'q', { label: 'next', directed: true })],
    },
  })

  // -- Out of legs: flip the frontier to `return`. Higher priority than travel so
  //    it pre-empts a new leg the moment the budget is spent.
  const toReturn = rule({
    name: '3 · Out of legs → head home',
    description: 'When `legs` reaches 0 the frontier switches from `travel` to `return`, so the next step is the trip back to the giver.',
    color: '#7048e8',
    priority: 80,
    lhs: {
      nodes: [
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'travel' }, { key: 'legs', op: 'lte', value: 0 }] }),
      ],
      edges: [],
    },
    rhs: { nodes: [rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('return') } })], edges: [] },
  })

  // -- Return tail: report back to the giver and dissolve the frontier. With no
  //    Quest node left, nothing matches and the grammar terminates.
  const returnHome = rule({
    name: '4 · Report back to the giver (quest complete)',
    description:
      "The `return`-phase frontier appends a 'report' Step linked back to the Giver (closing the quest loop) and DELETES the Quest node. No frontier means no further matches , the quest is complete.",
    color: '#f59f00',
    priority: 30,
    lhs: {
      nodes: [pn('g', 'Giver'), pn('s', '*', { wildcard: true }), pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'return' }] })],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [rn('g', 'Giver', { mapFrom: 'g' }), rn('s', '*', { mapFrom: 's' }), rn('r', 'report', { setProps: { n: counter() } })],
      edges: [re('th', 's', 'r', { label: 'then', directed: true }), re('dl', 'r', 'g', { label: 'delivers', directed: true })],
    },
    embedding: [emb('q', 'remove')],
  })

  return grammar(
    '07 · Quest Generator (fact-consuming)',
    [accept, travelUnexplored, travelKnown, actSlay, actFetch, actSearch, toReturn, returnHome],
    start,
    { strategy: 'priority', maxSteps: -1, maxNodes: 60, seed: 11 }
  )
}
