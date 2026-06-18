import type { Grammar } from '../types.ts'
import { grammar } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'
import { condensationRules } from './_condensation-rules.ts'

// ---------------------------------------------------------------------------
// Network optimisation at scale , the same cycle-condensation rules as the
// small `network` example, applied to a generated 138-node network.
//
// A directed backbone spine (acyclic, survives untouched) carries 36 loop
// clusters , 18 routing loops (3-cycles) and 18 mutual links (2-cycles), each
// serving a host. Run it (Run to end) and watch ~36 cycles collapse: every loop
// contracts to a single router that inherits its host edge, dropping 138 → 84
// nodes while the spine and hosts remain. A good stress view of the matcher,
// the redirectTo embedding, and the rendering at 100+ nodes.
// ---------------------------------------------------------------------------
export function networkCondensationLarge (): Grammar {
  const start = emptyGraph()
  const node = (label: string, x: number, y: number): string => {
    const n = makeNode(label, {}, x, y)
    start.nodes.push(n)
    return n.id
  }
  const link = (s: string, t: string) => start.edges.push(makeEdge(s, t, '', true)) // directed route

  // Backbone spine , a directed path with no cycles, so it is never rewritten.
  const SPINE = 12
  const spine: string[] = []
  for (let i = 0; i < SPINE; i++) {
    const id = node('R', 110, 90 + i * 70)
    if (i) link(spine[i - 1], id)
    spine.push(id)
  }

  // Three loop clusters hang off each spine node, fanned to the right and
  // alternating 3-cycle / 2-cycle. Each cluster serves one host leaf.
  let ci = 0
  for (let i = 0; i < SPINE; i++) {
    const anchor = spine[i]
    const ay = 90 + i * 70
    for (let j = 0; j < 3; j++) {
      const cx = 320 + j * 250
      const cy = ay + (j - 1) * 46
      if (ci % 2 === 0) {
        // directed 3-cycle (routing loop) + the host it serves
        const c1 = node('R', cx, cy)
        const c2 = node('R', cx + 72, cy - 46)
        const c3 = node('R', cx + 36, cy + 50)
        link(c1, c2)
        link(c2, c3)
        link(c3, c1)
        link(anchor, c1)
        link(c2, node('H', cx + 150, cy - 30))
      } else {
        // directed 2-cycle (mutual link) + the host it serves
        const m1 = node('R', cx, cy)
        const m2 = node('R', cx + 90, cy)
        link(m1, m2)
        link(m2, m1)
        link(anchor, m1)
        link(m2, node('H', cx + 180, cy))
      }
      ci++
    }
  }

  const { contractLoop, collapseMutual } = condensationRules()

  return grammar('Network · Cycle Condensation (large)', [contractLoop, collapseMutual], start, {
    strategy: 'priority',
    maxSteps: 200,
    seed: 5,
  })
}
