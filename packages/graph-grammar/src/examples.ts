import type { Grammar } from './types.ts'
import { triangleToChain } from './examples/triangle.ts'
import { plantGrowth } from './examples/plant.ts'
import { subdivide } from './examples/subdivide.ts'
import { infection } from './examples/infection.ts'
import { binaryTree } from './examples/tree.ts'
import { nodeMerge } from './examples/merge.ts'
import { networkCondensation } from './examples/network.ts'
import { networkCondensationLarge } from './examples/network-large.ts'
import { trafficRoundabout } from './examples/traffic.ts'
import { dungeon } from './examples/dungeon.ts'
import { questGenerator } from './examples/quest.ts'
import { questBranching } from './examples/quest-branching.ts'
import { questParallel } from './examples/quest-parallel.ts'
import { questEpic } from './examples/quest-epic.ts'
import { fractalGrowth } from './examples/fractal.ts'
import { combustion } from './examples/combustion.ts'
import { dielsAlder } from './examples/diels-alder.ts'
import { polymerization } from './examples/polymerization.ts'
import { proppMorphology } from './examples/propp.ts'
import { proppMorphologyV2 } from './examples/propp-v2.ts'
import { falloutQuests } from './examples/fallout.ts'
import { cakePlanner } from './examples/planner.ts'
import { cakeOrBread } from './examples/planner-paths.ts'
import { kitchenPlanner } from './examples/kitchen.ts'
import { blank } from './examples/blank.ts'

// ============================================================================
// The example-grammar registry. Each example lives in its own file under
// ./examples/ and teaches one mechanism (or, for the applied ones, solves a
// concrete problem). This module is the public `graph-grammar/examples` entry:
// it just collects them into an ordered, titled list.
// ============================================================================

export interface ExampleEntry {
  key: string;
  title: string;
  blurb: string;
  /** Display category for the collapsible example gallery. */
  group: string;
  build: () => Grammar;
}

export const EXAMPLES: ExampleEntry[] = [
  { key: 'triangle', title: 'Triangle → Chain', group: 'Fundamentals', blurb: "The brief's example: 3 connected A's become a B chain.", build: triangleToChain },
  { key: 'plant', title: 'Plant Growth', group: 'Fundamentals', blurb: 'L-system style stochastic growth with flowering.', build: plantGrowth },
  { key: 'subdivide', title: 'Edge Subdivision', group: 'Fundamentals', blurb: 'Insert a midpoint into every edge (maximal/parallel).', build: subdivide },
  { key: 'infection', title: 'Infection Spread', group: 'Fundamentals', blurb: 'Property predicates + probabilities on a network.', build: infection },
  { key: 'tree', title: 'Binary Tree', group: 'Fundamentals', blurb: 'Recursive growth bounded by a depth predicate.', build: binaryTree },
  { key: 'merge', title: 'Node Merge (contraction)', group: 'Fundamentals', blurb: 'X,* deletes the neighbour; X inherits all its edges (redirectTo embedding).', build: nodeMerge },
  { key: 'network', title: '◆ Network: Cycle Condensation', group: 'Networks & Applied', blurb: 'Collapse redundant cyclic routes (loops, mutual links) into single nodes that inherit their connections.', build: networkCondensation },
  { key: 'network-large', title: '◆ Network: Cycle Condensation (large)', group: 'Networks & Applied', blurb: 'The same condensation at scale , a generated 138-node network whose 36 loops collapse to 84 nodes.', build: networkCondensationLarge },
  { key: 'traffic', title: '◆ Traffic: Stops → Roundabouts', group: 'Networks & Applied', blurb: 'Upgrade junctions by precondition: busy 4-ways become roundabouts, busy 3-ways get signals.', build: trafficRoundabout },
  { key: 'dungeon', title: '★ Dungeon Generator', group: 'Generators & Showcases', blurb: 'Big multi-phase showcase: spine, branches, locks, keys, monsters.', build: dungeon },
  { key: 'quest', title: 'Quest Generator', group: 'Generators & Showcases', blurb: 'Consumes world facts (areas/foes) to grow a quest; prefers unexplored areas.', build: questGenerator },
  { key: 'quest2', title: 'Quest Generator II', group: 'Generators & Showcases', blurb: 'Branching approaches (loud/stealth, gated by a side-exit edge) + failure terminals.', build: questBranching },
  { key: 'quest3', title: 'Quest Generator III', group: 'Generators & Showcases', blurb: 'Parallel objectives: AND-fork into independent branches that barrier-join.', build: questParallel },
  { key: 'epic', title: '★★ Epic Multi-Quest World', group: 'Generators & Showcases', blurb: 'Stress test: a 3-region world where all 7 quest archetypes generate in parallel.', build: questEpic },
  { key: 'propp', title: "📖 Propp's Morphology", group: 'Generators & Showcases', blurb: "Propp's 31 folktale functions as a fixed-order grammar: a Tale frontier walks the canonical sequence, skipping optional functions. The villain is seeded early and the magical agent is a Chekhov's gun the climax must fire.", build: proppMorphology },
  { key: 'propp2', title: "📖 Propp's Morphology II (concrete tale)", group: 'Generators & Showcases', blurb: 'v2: the structural skeleton (pass 1) plus a second, lower-priority concretization pass that draws a random cast of characters/items/places and knits each abstract function into hand-authored prose. narrateTale() renders the result as a readable story.', build: proppMorphologyV2 },
  { key: 'fallout', title: '☢ Fallout: Quest Chains (scraped)', group: 'Generators & Showcases', blurb: 'Real quest-stage data scraped from the Fallout wiki, modelled as quest chains: a spine of mandatory stages, optional branches that rejoin, and success/failure terminals. A token plays through each chain, choosing branches and halting at a terminal.', build: falloutQuests },
  { key: 'fractal', title: '⚡ Fractal Growth (stress)', group: 'Generators & Showcases', blurb: 'Uncapped binary growth , hit ⚡ Turbo to see raw steps/sec.', build: fractalGrowth },
  { key: 'combustion', title: '🔥 Chemistry: Hydrogen Combustion', group: 'Chemistry', blurb: 'Track a free-radical chain: atoms are nodes, bonds are edges; initiation/branching/propagation/termination turn H₂+O₂ into H₂O.', build: combustion },
  { key: 'diels-alder', title: '⬡ Chemistry: Diels–Alder', group: 'Chemistry', blurb: 'One concerted rule: a diene + dienophile rearrange three bonds into a cyclohexene ring.', build: dielsAlder },
  { key: 'polymerization', title: '🧬 Chemistry: Addition Polymerisation', group: 'Chemistry', blurb: 'Chain growth , a carbon radical adds vinyl monomers one by one; the polymer backbone snakes out like an L-system.', build: polymerization },
  { key: 'planner', title: '🎂 Planner: Bake a Cake', group: 'Planning', blurb: 'Goal-directed planning over facts (eggs/flour/money): plan beat→cream→mix→bake, and recover by buying or substituting when an ingredient runs out.', build: cakePlanner },
  { key: 'planner-paths', title: '🧭 Planner II: Cake vs Bread', group: 'Planning', blurb: 'Inventory as nodes + competing recipes sharing one flour. Greedy forward grabs it for bread and starves the cake; the backtracking plan() search finds the cake.', build: cakeOrBread },
  { key: 'kitchen', title: '🍰 Planner III: Pick a Dish', group: 'Planning', blurb: 'A bigger kitchen: five dishes whose recipes collide over scarce ingredients. Pick a target dish and the backtracking planner crafts it; greedy forward just bakes cookies.', build: kitchenPlanner },
  { key: 'blank', title: 'Blank canvas', group: 'Authoring', blurb: 'Start authoring from scratch.', build: blank },
]

export function buildExample (key: string): Grammar {
  const e = EXAMPLES.find((x) => x.key === key)
  return (e ?? EXAMPLES[0]).build()
}
