import type { LayoutKind } from './types.ts'
import { StaticLayout } from './static.ts'

// Dagre layered/hierarchical layout. The library is loaded lazily (dynamic
// import) so it stays out of the main bundle until this layout is chosen.
export class DagreLayout extends StaticLayout {
  readonly kind: LayoutKind = 'dagre'

  private dagre: any = null

  protected async compute () {
    if (!this.nodes.length) return
    if (!this.dagre) this.dagre = (await import('@dagrejs/dagre')).default
    if (this.disposed) return
    const dagre = this.dagre
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 60, marginx: 24, marginy: 24 })
    g.setDefaultEdgeLabel(() => ({}))
    const D = 28
    for (const n of this.nodes) g.setNode(n.id, { width: D, height: D })
    for (const l of this.links) if (l.source.id !== l.target.id) g.setEdge(l.source.id, l.target.id)
    dagre.layout(g)
    for (const n of this.nodes) {
      const d = g.node(n.id)
      if (d) {
        n.x = d.x
        n.y = d.y
        n.fx = null
        n.fy = null
      }
    }
    this.h.onTick()
    this.h.onEnd()
  }
}
