import type { LayoutKind } from './types.ts'
import { StaticLayout } from './static.ts'

// ELK layered layout (orthogonal routing). Async , the engine is loaded lazily
// and runs in the main thread; we guard against overlapping runs.
export class ElkLayout extends StaticLayout {
  readonly kind: LayoutKind = 'elk'

  private elk: any = null
  private running = false
  private dirty = false

  protected async compute () {
    if (!this.nodes.length) return
    if (this.running) {
      this.dirty = true
      return
    }
    this.running = true
    try {
      if (!this.elk) {
        const ELK = (await import('elkjs/lib/elk.bundled.js')).default
        this.elk = new ELK()
      }
      if (this.disposed) return
      const D = 28
      const graph = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '36',
          'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        },
        children: this.nodes.map((n) => ({ id: n.id, width: D, height: D })),
        edges: this.links
          .filter((l) => l.source.id !== l.target.id)
          .map((l, i) => ({ id: 'e' + i, sources: [l.source.id], targets: [l.target.id] })),
      }
      const res = await this.elk.layout(graph)
      if (this.disposed) return

      const byId = new Map<string, any>((res.children ?? []).map((c: any) => [c.id, c]))
      for (const n of this.nodes) {
        const c = byId.get(n.id)
        if (c) {
          n.x = (c.x ?? 0) + (c.width ?? 0) / 2
          n.y = (c.y ?? 0) + (c.height ?? 0) / 2
          n.fx = null
          n.fy = null
        }
      }
      this.h.onTick()
      this.h.onEnd()
    } catch {
      /* layout failed , leave current positions */
    } finally {
      this.running = false
      if (this.dirty && !this.disposed) {
        this.dirty = false
        this.compute()
      }
    }
  }
}
