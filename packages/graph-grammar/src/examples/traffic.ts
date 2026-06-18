import type { Grammar, PatternNode } from '../types.ts'
import { pn, rn, re, rule, grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Traffic engineering , upgrade intersections based on preconditions.
//
// A road network of "stop"-controlled junctions. Whether a junction is
// upgraded, and to WHAT, is decided by two preconditions read straight off the
// graph: traffic volume (a node property) and the number of approaches (the
// node's degree). Same trigger (high traffic), different structure, different
// outcome:
//   • a busy 4-way (degree 4)  → a roundabout (the junction is kept and a
//                                circulating ring of four lanes is built around it);
//   • a busy 3-way (degree 3)  → a signalised junction (relabelled in place).
// A low-traffic 4-way is left as a stop sign , the precondition gates the work.
// ---------------------------------------------------------------------------
export function trafficRoundabout (): Grammar {
  const start = emptyGraph()
  const cols = 5
  const rows = 3
  const G: string[][] = []
  for (let r = 0; r < rows; r++) {
    G[r] = []
    for (let c = 0; c < cols; c++) {
      const n = makeNode('stop', { traffic: 'low' }, 110 + c * 165, 150 + r * 165)
      start.nodes.push(n)
      G[r][c] = n.id
    }
  }
  // two-way roads between grid neighbours
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) start.edges.push(makeEdge(G[r][c], G[r][c + 1], '', false))
      if (r + 1 < rows) start.edges.push(makeEdge(G[r][c], G[r + 1][c], '', false))
    }
  }
  const setTraffic = (id: string, t: string) => {
    const n = start.nodes.find((x) => x.id === id)
    if (n) n.props.traffic = t
  }
  // Interior nodes (1,1) (1,2) (1,3) are the only 4-way junctions. Make two of
  // them busy (→ roundabouts) and leave the middle one quiet (→ stays a stop) so
  // the precondition's effect is visible. One busy edge node (0,2) is a 3-way.
  setTraffic(G[1][1], 'high')
  setTraffic(G[1][3], 'high')
  setTraffic(G[0][2], 'high')

  // --- rule 1: busy 4-way → roundabout ---
  const toRoundabout = rule({
    name: 'Busy 4-way stop → roundabout',
    description:
      "A 'stop' junction with high traffic AND exactly four approaches is converted to a roundabout: the junction is preserved (keeping its four roads) and relabelled, and a one-way circulating ring of four lanes is built around it. Low-traffic or non-4-way junctions don't match , the two preconditions (property + degree) gate the upgrade.",
    color: '#4dabf7',
    lhs: {
      nodes: [pn('j', 'stop', { predicates: [{ key: 'traffic', op: 'eq', value: 'high' }], x: 235, y: 235 })],
      edges: [],
    },
    rhs: {
      nodes: [
        rn('j', 'roundabout', { mapFrom: 'j', x: 235, y: 235 }), // preserved + relabelled; keeps its 4 approaches
        rn('l1', 'lane', { x: 235, y: 150 }),
        rn('l2', 'lane', { x: 320, y: 235 }),
        rn('l3', 'lane', { x: 235, y: 320 }),
        rn('l4', 'lane', { x: 150, y: 235 }),
      ],
      edges: [
        // the circulating carriageway (one-way ring)
        re('c1', 'l1', 'l2', { directed: true }),
        re('c2', 'l2', 'l3', { directed: true }),
        re('c3', 'l3', 'l4', { directed: true }),
        re('c4', 'l4', 'l1', { directed: true }),
        // spokes from the centre to each lane
        re('s1', 'j', 'l1'),
        re('s2', 'j', 'l2'),
        re('s3', 'j', 'l3'),
        re('s4', 'j', 'l4'),
      ],
    },
  });
  // precondition: exactly four approaches (a true 4-way). After conversion the
  // junction is a "roundabout" (and higher degree), so it never re-matches.
  (toRoundabout.lhs.nodes[0] as PatternNode).exactDegree = 4

  // --- rule 2: busy 3-way → traffic signal ---
  const toSignal = rule({
    name: 'Busy 3-way stop → traffic signal',
    description:
      "A high-traffic 'stop' with exactly three approaches (a T-junction) doesn't warrant a roundabout , it is signalised instead, relabelled in place. Same trigger as the roundabout rule (high traffic) but a different precondition (degree 3) produces a different outcome.",
    color: '#51cf66',
    lhs: {
      nodes: [pn('j', 'stop', { predicates: [{ key: 'traffic', op: 'eq', value: 'high' }], x: 235, y: 235 })],
      edges: [],
    },
    rhs: {
      nodes: [rn('j', 'signal', { mapFrom: 'j', x: 235, y: 235 })],
      edges: [],
    },
  });
  (toSignal.lhs.nodes[0] as PatternNode).exactDegree = 3

  return grammar('Traffic · Stops → Roundabouts', [toRoundabout, toSignal], start, {
    strategy: 'priority',
    maxSteps: 30,
    seed: 11,
  })
}
