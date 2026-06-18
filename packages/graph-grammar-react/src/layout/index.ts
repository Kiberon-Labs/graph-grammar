import type { GraphLayout, LayoutKind, LayoutHandlers } from './types.ts'
import { ForceLayout } from './force.ts'
import { DagreLayout } from './dagre.ts'
import { ElkLayout } from './elk.ts'

export function createLayout (kind: LayoutKind, h: LayoutHandlers): GraphLayout {
  switch (kind) {
    case 'dagre':
      return new DagreLayout(h)
    case 'elk':
      return new ElkLayout(h)
    default:
      return new ForceLayout(h)
  }
}

export * from './types.ts'
