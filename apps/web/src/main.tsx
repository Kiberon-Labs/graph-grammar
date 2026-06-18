import './index.css'
import 'graph-grammar-react/styles.css'
import { createRoot } from 'react-dom/client'
import { AppState, Workbench, type NodeStyleResolver } from 'graph-grammar-react'

// A custom node renderer , the headline showcase of how customisable the React
// front end is, and proof that one resolver can serve several domains. Nodes
// whose label/props don't match any case fall through to the default look.
const nodeStyle: NodeStyleResolver = (node) => {
  // "Infection Spread": tell susceptible / infected / recovered people apart.
  if (node.label === 'person') {
    switch (node.props.state) {
      case 'I': // actively infected , large red diamond with an alert ring
        return { shape: 'diamond', radius: 16, fill: '#fa5252', stroke: '#fff0f0', ring: '#ff8787', glyph: '!', textColor: '#fff' }
      case 'R': // recovered / immune , green circle with a check
        return { shape: 'circle', radius: 11, fill: '#2f9e44', stroke: '#d3f9d8', glyph: '✓', textColor: '#fff' }
      default: // susceptible , small muted circle
        return { shape: 'circle', radius: 8, fill: '#495057', stroke: '#868e96', text: null }
    }
  }

  // "Planner: Bake a Cake": make the goal state obvious , amber "?" while the
  // plan is open, green "✓" once a cake has been achieved , and let the Cake pop.
  if (node.label === 'Goal') {
    return node.props.status === 'achieved'
      ? { shape: 'circle', radius: 14, fill: '#2f9e44', stroke: '#d3f9d8', ring: '#b2f2bb', glyph: '✓', textColor: '#fff' }
      : { shape: 'square', radius: 13, fill: '#f08c00', stroke: '#ffe8cc', glyph: '?', textColor: '#fff' }
  }
  if (node.label === 'Cake') {
    return { shape: 'hexagon', radius: 16, fill: '#f783ac', stroke: '#fff0f6', ring: '#fcc2d7', textColor: '#fff' }
  }

  // "Fallout: Quest Chains": make the chain structure legible , the giver, the
  // mandatory spine, optional side-steps, success/failure terminals, and the
  // walkthrough token.
  switch (node.label) {
    case 'Quest': // the quest giver / chain head
      return { shape: 'square', radius: 15, fill: '#f08c00', stroke: '#ffe8cc', glyph: '☢', textColor: '#fff' }
    case 'Stage': // a mandatory step on the spine (dim once visited)
      return { shape: 'circle', radius: 12, fill: node.props.visited ? '#3b5bdb' : '#4263eb', stroke: '#dbe4ff', textColor: '#fff', opacity: node.props.visited ? 0.6 : 1 }
    case 'Optional': // an optional side-step
      return { shape: 'circle', radius: 10, fill: '#7048e8', stroke: '#d0bfff', textColor: '#fff', opacity: node.props.visited ? 0.55 : 0.85 }
    case 'End': // success terminal (ring once reached)
      return { shape: 'circle', radius: 14, fill: '#2f9e44', stroke: '#d3f9d8', ring: node.props.reached ? '#b2f2bb' : undefined, glyph: '✓', textColor: '#fff' }
    case 'Fail': // failure terminal
      return { shape: 'diamond', radius: 14, fill: '#e03131', stroke: '#ffe3e3', ring: node.props.reached ? '#ffc9c9' : undefined, glyph: '✕', textColor: '#fff' }
    case 'Token': // the playthrough cursor
      return { shape: 'circle', radius: 7, fill: '#f783ac', stroke: '#fff0f6', text: null }
  }

  return undefined
}

// This app is a thin demo shell: it constructs the editor's controller and
// mounts the full <Workbench>. Everything embeddable lives in the
// `graph-grammar-react` package.
const root = document.getElementById('app')
if (root) {
  const app = new AppState()
  createRoot(root).render(<Workbench app={app} nodeStyle={nodeStyle} examples />)
}
