import type { Grammar } from '../types.ts'
import { pn, pe, rn, re, rule, grammar, lit, randInt, counter } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 7. Showcase , Dungeon Generator. A grammar that grows a dungeon graph:
//    start → main path of rooms → branches → special rooms → locks & keys →
//    decorate. Uses labels, properties, stochastic weights, priorities, and
//    edge embedding. Designed to be stepped through to show progressive detail.
// ---------------------------------------------------------------------------
export function dungeon (): Grammar {
  const start = emptyGraph()
  start.nodes.push(makeNode('Start', { tier: 0 }, 400, 320))

  // Phase A (high priority): lay down the spine of the dungeon.
  const grow = rule({
    name: 'A1 · Extend main path',
    description: "The frontier (a 'Path' tip) extends into another room, advancing the dungeon spine.",
    color: '#4dabf7',
    priority: 10,
    weight: 3,
    maxApplications: 7,
    lhs: { nodes: [pn('p', 'Path')], edges: [] },
    rhs: {
      nodes: [
        rn('r', 'Room', { mapFrom: 'p', setProps: { tier: counter() } }),
        rn('p2', 'Path', {}),
      ],
      edges: [re('c', 'r', 'p2', { label: 'corridor', directed: true })],
    },
  })

  const seedPath = rule({
    name: 'A0 · Open from Start',
    description: 'The Start node opens a Path frontier.',
    color: '#3bc9db',
    priority: 20,
    maxApplications: 1,
    lhs: { nodes: [pn('s', 'Start')], edges: [] },
    rhs: {
      nodes: [rn('s', 'Start', { mapFrom: 's' }), rn('p', 'Path', {})],
      edges: [re('c', 's', 'p', { label: 'corridor', directed: true })],
    },
  })

  const cap = rule({
    name: 'A2 · Seal the path into a Boss room',
    description: 'When the path has run its course, the final Path tip becomes the Boss room.',
    color: '#f06595',
    priority: 1,
    maxApplications: 1,
    lhs: { nodes: [pn('p', 'Path')], edges: [] },
    rhs: { nodes: [rn('boss', 'Boss', { mapFrom: 'p' })], edges: [] },
  })

  // Phase B: branch off side rooms from existing rooms (stochastic). Capped so
  // the breadth-building phase terminates and lower-priority phases get a turn.
  const branch = rule({
    name: 'B1 · Branch a side room',
    description: "A Room sprouts a side Room via a corridor (probabilistic). Builds the dungeon's breadth. Capped at 8 applications so later phases can run.",
    color: '#94d82d',
    priority: 5,
    probability: 0.6,
    weight: 2,
    maxApplications: 8,
    lhs: { nodes: [pn('r', 'Room')], edges: [] },
    rhs: {
      nodes: [rn('r', 'Room', { mapFrom: 'r' }), rn('s', 'Room', { setProps: { tier: counter(), branch: lit(true) } })],
      edges: [re('c', 'r', 's', { label: 'corridor', directed: true })],
    },
  })

  // Phase C: convert leaf side-rooms (true dead ends, degree 1) into treasure.
  const treasure = rule({
    name: 'C1 · Treasure in a dead end',
    description: 'A branch Room that is a dead end (exactly one connection) becomes a Treasure room. Uses an exact-degree context condition.',
    color: '#ffd43b',
    priority: 3,
    probability: 0.7,
    lhs: {
      nodes: [
        pn('r', 'Room', {
          predicates: [{ key: 'branch', op: 'eq', value: true }],
        }),
      ],
      edges: [],
    },
    rhs: { nodes: [rn('t', 'Treasure', { mapFrom: 'r' })], edges: [] },
  })
  treasure.lhs.nodes[0].exactDegree = 1

  // Phase D: place a lock on a corridor and a key in another room (gameplay gating).
  const lockKey = rule({
    name: 'D1 · Add lock & key',
    description: 'A corridor between two Rooms becomes Locked, and a Key node is placed on one side. Demonstrates two-context rewriting.',
    color: '#e8590c',
    priority: 2,
    probability: 0.5,
    maxApplications: 3,
    lhs: {
      nodes: [pn('a', 'Room'), pn('b', 'Room')],
      edges: [pe('c', 'a', 'b', { label: 'corridor', directed: true })],
    },
    rhs: {
      nodes: [
        rn('a', 'Room', { mapFrom: 'a' }),
        rn('b', 'Room', { mapFrom: 'b' }),
        rn('key', 'Key', { setProps: { id: counter() } }),
      ],
      edges: [
        re('c', 'a', 'b', { label: 'locked', directed: true }),
        re('holds', 'a', 'key', { label: 'holds', directed: true }),
      ],
    },
  })

  // Phase E: decorate rooms with monsters (parallel/maximal-friendly).
  const monster = rule({
    name: 'E1 · Spawn monster',
    description: 'A Room gains a Monster (with random difficulty). Lowest-priority decoration step, capped so it terminates.',
    color: '#ff8787',
    priority: 1,
    probability: 0.6,
    maxApplications: 14,
    lhs: {
      nodes: [pn('r', 'Room')],
      edges: [],
    },
    rhs: {
      nodes: [rn('r', 'Room', { mapFrom: 'r' }), rn('m', 'Monster', { setProps: { hp: randInt(10, 60) } })],
      edges: [re('in', 'r', 'm', { label: 'contains', directed: true })],
    },
  })

  const g = grammar(
    '★ Showcase · Dungeon Generator',
    [seedPath, grow, branch, cap, treasure, lockKey, monster],
    start,
    { strategy: 'priority', maxSteps: -1, maxNodes: 90, seed: 1337 }
  )
  return g
}
