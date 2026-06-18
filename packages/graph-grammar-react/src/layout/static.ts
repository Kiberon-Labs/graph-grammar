import type { GraphLayout, LayoutLink, LayoutHandlers, LayoutKind, LayoutNode } from './types.ts'

// ============================================================================
// Base for one-shot (non-physics) layouts like Dagre and ELK. They compute node
// positions in a single pass; recomputes are debounced so rapid graph changes
// (e.g. during Play) coalesce. Dragging a node just moves it , no relayout.
// ============================================================================

export abstract class StaticLayout implements GraphLayout {
  abstract readonly kind: LayoutKind
  readonly interactive = false
  protected nodes: LayoutNode[] = []
  protected links: LayoutLink[] = []
  protected disposed = false
  private timer = 0

  constructor (protected h: LayoutHandlers) { }

  setGraph (nodes: LayoutNode[], links: LayoutLink[]) {
    this.nodes = nodes
    this.links = links
  }

  run (structural: boolean) {
    if (structural) this.schedule()
  }

  reheat () {
    this.compute()
  }

  wake () {
    /* static layouts don't animate; nothing to wake */
  }

  stop () {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    }
  }

  dragStart () { }
  dragMove (n: LayoutNode, x: number, y: number) {
    n.x = x
    n.y = y
    this.h.onTick()
  }

  dragEnd () { }
  destroy () {
    this.disposed = true
    this.stop()
  }

  private schedule () {
    if (this.timer) clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.compute()
    }, 120)
  }

  protected abstract compute (): Promise<void> | void
}
