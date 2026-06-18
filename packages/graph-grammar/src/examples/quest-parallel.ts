import type { Grammar } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit, counter, copyProp, incProp } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 11. Quest Generator III , Parallel objectives (AND-fork / barrier join).
//     Where example 2's branch was an OR (pick loud OR stealth, they rejoin),
//     this is an AND: the quest fans out into several sub-quests that must ALL
//     complete before it can continue , "disable the alarm AND crack the vault
//     AND open the gate, then exfil". Each parallel objective is generated and
//     elaborated independently, by its own live frontier.
//
//     The hard part of an AND-join in graph rewriting is the BARRIER: knowing
//     when every branch is done, when branches finish in any order. We use a
//     counter on the Join node:
//        • `open-fork` creates a Fork fan-out and a Join{pending:0}.
//        • `spawn-branch` fires once per unclaimed Objective: it claims the
//          objective, emits an independent `Task` branch frontier, and does
//          pending += 1. (A distinct `Task` label keeps branch frontiers from
//          being confused with the main `Quest` frontier , several `next`
//          pointers are live at once during the parallel phase.)
//        • each branch elaborates (goto → secure) then `branch-arrive` wires it
//          into the Join and does pending -= 1, dissolving that Task frontier.
//        • `close-join` is the barrier: it fires ONLY when pending == 0 (with a
//          NAC that no unclaimed Objective remains, so it can't fire before the
//          branches are even spawned). It moves the main frontier past the Join
//          and the quest resumes linearly to the return.
//
//     Step through and watch Join.pending tick up as branches spawn and back
//     down as they complete; the quest continues the instant it hits zero.
// ---------------------------------------------------------------------------
export function questParallel (): Grammar {
  const start = emptyGraph()

  const giver = makeNode('Giver', { name: 'Spymaster', motivation: 'conquest' }, 120, 320)
  start.nodes.push(giver)

  // The parallel objectives , each becomes its own independent sub-quest.
  for (const [name, x, y] of [
    ['Alarm', 560, 140],
    ['Vault', 700, 320],
    ['Gate', 560, 500],
  ] as Array<[string, number, number]>) {
    start.nodes.push(makeNode('Objective', { name }, x, y))
  }

  // -- 0. Accept the quest.
  const accept = rule({
    name: '0 · Accept the operation',
    description: "The Giver opens the main Quest frontier (phase 'plan').",
    color: '#f59f00',
    priority: 100,
    maxApplications: 1,
    lhs: { nodes: [pn('g', 'Giver')], edges: [] },
    rhs: {
      nodes: [
        rn('g', 'Giver', { mapFrom: 'g' }),
        rn('s', 'accept', { setProps: { n: counter() } }),
        rn('q', 'Quest', { setProps: { phase: lit('plan'), motivation: copyProp('g', 'motivation') } }),
      ],
      edges: [re('gv', 'g', 's', { label: 'gives', directed: true }), re('nx', 's', 'q', { label: 'next', directed: true })],
    },
  })

  // -- 1. Open the parallel section: a Fork fan-out node and a Join barrier with
  //       a pending counter. The main frontier becomes the dispatcher (forking).
  const openFork = rule({
    name: '1 · Open parallel section (fork + join)',
    description: "Splices a Fork fan-out and a Join{pending:0} barrier. The main frontier sits on the Fork in phase 'forking', ready to spawn one branch per objective.",
    color: '#7048e8',
    priority: 90,
    maxApplications: 1,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'plan' }] })],
      edges: [pe('e', 's', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('fork', 'Fork', {}),
        rn('join', 'Join', { setProps: { pending: lit(0) } }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('forking') } }),
      ],
      edges: [
        re('th', 's', 'fork', { label: 'then', directed: true }),
        re('nx', 'fork', 'q', { label: 'next', directed: true }),
        re('split', 'fork', 'join', { label: 'split', directed: true }),
      ],
    },
  })

  // -- 2. Spawn one independent branch per unclaimed Objective: claim it, emit a
  //       Task frontier with its own 'goto', and increment the Join's pending.
  const spawnBranch = rule({
    name: '2 · Spawn a branch per objective',
    description:
      "For each Objective not yet claimed, mark it claimed, fan out a 'goto' Step from the Fork into a new independent Task frontier, and do Join.pending += 1. Fires once per objective; stops when all are claimed.",
    color: '#4dabf7',
    priority: 85,
    lhs: {
      nodes: [
        pn('fork', 'Fork'),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'forking' }] }),
        pn('o', 'Objective', { predicates: [{ key: 'claimed', op: 'absent' }] }),
        pn('j', 'Join'),
      ],
      edges: [pe('disp', 'fork', 'q', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('fork', 'Fork', { mapFrom: 'fork' }),
        rn('q', 'Quest', { mapFrom: 'q' }),
        rn('o', 'Objective', { mapFrom: 'o', setProps: { claimed: lit(true) } }),
        rn('j', 'Join', { mapFrom: 'j', setProps: { pending: incProp('j', 'pending', 1) } }),
        rn('g', 'goto', { setProps: { n: counter(), area: copyProp('o', 'name') } }),
        rn('t', 'Task', { setProps: { obj: copyProp('o', 'name'), step: lit('go') } }),
      ],
      edges: [
        re('disp', 'fork', 'q', { label: 'next', directed: true, mapFrom: 'disp' }), // preserve the dispatcher pointer
        re('th', 'fork', 'g', { label: 'then', directed: true }),
        re('at', 'g', 'o', { label: 'targets', directed: true }),
        re('bnx', 'g', 't', { label: 'next', directed: true }),
      ],
    },
  })

  // -- 3. Each branch does its objective action (goto → secure), independently.
  const branchWork = rule({
    name: '3 · Branch performs its objective',
    description: "A Task frontier (step 'go') appends a 'secure' Step carrying its objective name, then becomes 'return' , ready to join.",
    color: '#20c997',
    priority: 70,
    lhs: {
      nodes: [pn('p', '*', { wildcard: true }), pn('t', 'Task', { predicates: [{ key: 'step', op: 'eq', value: 'go' }] })],
      edges: [pe('e', 'p', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('p', '*', { mapFrom: 'p' }),
        rn('sec', 'secure', { setProps: { n: counter(), target: copyProp('t', 'obj') } }),
        rn('t', 'Task', { mapFrom: 't', setProps: { step: lit('return') } }),
      ],
      edges: [re('th', 'p', 'sec', { label: 'then', directed: true }), re('bnx', 'sec', 't', { label: 'next', directed: true })],
    },
  })

  // -- 4. Branch reaches the barrier: wire it into the Join, decrement pending,
  //       and dissolve the branch frontier.
  const branchArrive = rule({
    name: '4 · Branch arrives at the join',
    description: "A finished Task frontier (step 'return') connects its last Step into the Join, does Join.pending -= 1, and the Task frontier is deleted.",
    color: '#94d82d',
    priority: 65,
    lhs: {
      nodes: [pn('p', '*', { wildcard: true }), pn('t', 'Task', { predicates: [{ key: 'step', op: 'eq', value: 'return' }] }), pn('j', 'Join')],
      edges: [pe('e', 'p', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [rn('p', '*', { mapFrom: 'p' }), rn('j', 'Join', { mapFrom: 'j', setProps: { pending: incProp('j', 'pending', -1) } })],
      edges: [re('merge', 'p', 'j', { label: 'then', directed: true })],
    },
    embedding: [emb('t', 'remove')],
  })

  // -- 5. The BARRIER. Only when pending == 0 (and no objective is still
  //       unclaimed) does the main frontier move past the Join and resume.
  const closeJoin = rule({
    name: '5 · Barrier: all branches done → continue',
    description:
      "Fires only when Join.pending is 0. Moves the main frontier from the Fork onto the Join and flips it to 'return'. A NAC on any unclaimed Objective prevents it from firing before the branches are spawned.",
    color: '#f06595',
    priority: 40,
    maxApplications: 1,
    lhs: {
      nodes: [
        pn('fork', 'Fork'),
        pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'forking' }] }),
        pn('j', 'Join', { predicates: [{ key: 'pending', op: 'eq', value: 0 }] }),
      ],
      edges: [pe('disp', 'fork', 'q', { label: 'next', directed: true })],
    },
    nac: [{ nodes: [pn('u', 'Objective', { predicates: [{ key: 'claimed', op: 'absent' }] })], edges: [] }],
    rhs: {
      nodes: [
        rn('fork', 'Fork', { mapFrom: 'fork' }),
        rn('j', 'Join', { mapFrom: 'j' }),
        rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit('return') } }),
      ],
      // old fork→q 'next' is dropped (not mapped); frontier now trails the Join.
      edges: [re('nx', 'j', 'q', { label: 'next', directed: true })],
    },
  })

  // -- 6. Return: report and finish.
  const returnHome = rule({
    name: '6 · Regroup & report (complete)',
    description: "The frontier (now on the Join) appends 'report' linked back to the Giver and a DONE terminal, then deletes the Quest frontier.",
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

  return grammar(
    '09 · Quest Generator III (parallel objectives)',
    [accept, openFork, spawnBranch, branchWork, branchArrive, closeJoin, returnHome],
    start,
    { strategy: 'priority', maxSteps: -1, maxNodes: 80, seed: 9 }
  )
}
