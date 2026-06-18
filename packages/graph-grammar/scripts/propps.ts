import { fillTemplate, capitalizeFirst } from '../src/examples/propp-v2'
import { Graph } from '../src/types'

import * as graph from './graph.json'

export function narrateTale (g: Graph): string {
  const steps = g.nodes
    .filter((n) => typeof n.props?.n === 'number' && typeof n.props?.text === 'string')
    .sort((a, b) => (a.props.n as number) - (b.props.n as number))
  return steps.map((n) => n.label + ':' + capitalizeFirst(fillTemplate(n.props.text as string, n.props)) + '\n\n').join(' ')
}

console.log(narrateTale(graph as unknown as Graph))
