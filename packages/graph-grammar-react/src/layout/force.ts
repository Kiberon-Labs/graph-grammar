import * as d3 from 'd3'
import type { GraphLayout, LayoutLink, LayoutHandlers, LayoutNode } from './types.ts'

// ============================================================================
// ForceLayout , the original d3-force simulation behind the GraphLayout
// interface. Continuous + interactive: ticks every frame and responds to live
// dragging by pinning a node's fx/fy.
// ============================================================================

export class ForceLayout implements GraphLayout {
  readonly kind = 'force' as const
  readonly interactive = true
  private sim: d3.Simulation<LayoutNode, undefined>
  private linkForce: d3.ForceLink<LayoutNode, LayoutLink>
  private nodes: LayoutNode[] = []

  constructor (private h: LayoutHandlers) {
    this.linkForce = d3.forceLink<LayoutNode, LayoutLink>([]).id((d) => d.id).distance(60).strength(0.5)
    this.sim = d3
      .forceSimulation<LayoutNode>([])
      .force('link', this.linkForce)
      .force('charge', d3.forceManyBody<LayoutNode>().strength(-120).theta(0.9).distanceMax(400))
      .force('collide', d3.forceCollide<LayoutNode>(18))
      .force('x', d3.forceX<LayoutNode>(0).strength(0.03))
      .force('y', d3.forceY<LayoutNode>(0).strength(0.03))
      .alphaDecay(0.025)
      .on('tick', () => this.h.onTick())
      .on('end', () => this.h.onEnd())
    this.sim.stop()
  }

  setGraph (nodes: LayoutNode[], links: LayoutLink[]) {
    this.nodes = nodes
    this.sim.nodes(nodes)
    this.linkForce.links(links)
    // Scale cost to size: big graphs settle fast and drop collision so the page
    // reaches idle quickly instead of churning.
    const n = nodes.length
    this.sim.alphaDecay(n > 4000 ? 0.08 : 0.0228)
    const hasCollide = !!this.sim.force('collide')
    if (n > 8000 && hasCollide) this.sim.force('collide', null)
    else if (n <= 8000 && !hasCollide) this.sim.force('collide', d3.forceCollide<LayoutNode>(18))
  }

  run (structural: boolean) {
    if (structural) this.sim.alpha(this.nodes.length > 4000 ? 0.12 : 0.6).restart()
  }

  reheat () {
    this.sim.alpha(0.9).restart()
  }

  wake () {
    if (this.nodes.length < 2000) this.sim.alpha(0.3).restart()
  }

  stop () {
    this.sim.stop()
  }

  dragStart (n: LayoutNode) {
    n.fx = n.x
    n.fy = n.y
    this.sim.alphaTarget(0.2).restart()
  }

  dragMove (n: LayoutNode, x: number, y: number) {
    n.fx = x
    n.fy = y
  }

  dragEnd (n: LayoutNode, pin: boolean) {
    if (!pin) {
      n.fx = null
      n.fy = null
    }
    this.sim.alphaTarget(0)
  }

  destroy () {
    this.sim.on('tick', null).on('end', null)
    this.sim.stop()
  }
}
