/**
 * Conformance fixture generator.
 *
 * Produces the parity *target* for the native port by running the REAL
 * TypeScript engine, so the Rust DLL is checked against the engine's actual
 * behaviour rather than a hand-written expectation. Run with:
 *
 *   npx tsx conformance/generate.ts
 *
 * Each fixture writes two files under conformance/fixtures/:
 *   <name>.input.json    = { rule, graph }   (fed verbatim to gg_apply_rule)
 *   <name>.expected.json = { nodes, edges }  (engine result, via toGraph)
 *
 * Every fixture is built so the output is *exactly* comparable: only relabels
 * preserved nodes and deletes already-present (stable-id) edges ,no element
 * creation ,so no id-canonicalization is needed beyond ordering + layout.
 *
 * The ambiguous fixtures deliberately have MANY matches; they pin down
 * match-SELECTION parity (which match the engine's deterministic limit:1 path
 * returns): VF2++ seed = rarest label, neighbour iteration in incident-edge
 * insertion order, directed-orientation pruning, and predicate filtering.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GraphIndex, findMatches, findOneMatch, applyRule, RNG, Engine } from '../../graph-grammar/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'fixtures')
mkdirSync(outDir, { recursive: true })

type Fixture = { name: string, rule: any, graph: any, seed?: number }

const N = (id: string, label: string, props: any = {}) => ({ id, label, props })
const E = (id: string, source: string, target: string, label = '', directed = true) =>
  ({ id, source, target, label, props: {}, directed })

const baseRule = (over: any) => ({
  id: over.id ?? 'r',
  name: over.name ?? over.id ?? 'r',
  enabled: true,
  weight: 1,
  probability: 1,
  priority: 0,
  maxApplications: 0,
  morphism: [],
  embedding: [],
  ...over,
})

// A relabel rule (preserve the matched node, change its label) ,keeps engine
// runs creation-free so the final graph is exactly comparable (stable ids).
const relabelRule = (id: string, from: string, to: string, over: any = {}) => baseRule({
  id,
  lhs: { nodes: [N('L0', from)], edges: [] },
  rhs: { nodes: [{ ...N('R0', to), mapFrom: 'L0' }], edges: [] },
  ...over,
})

const cfg = (strategy: string, seed: number, maxSteps: number) =>
  ({ strategy, seed, maxSteps, maxNodes: 0 })

type EngineFixture = { name: string, grammar: any }

const fixtures: Fixture[] = [
  // 1. Unambiguous single-node relabel A → B.
  {
    name: 'relabel',
    rule: baseRule({
      id: 'r_relabel',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: { nodes: [{ ...N('R0', 'B'), mapFrom: 'L0' }], edges: [] },
    }),
    graph: {
      nodes: [N('h1', 'A'), N('h2', 'C', { weight: 3 })],
      edges: [E('e1', 'h1', 'h2', 'rel')],
    },
  },

  // 2. Many A's, single-node pattern → the engine picks the FIRST in byLabel
  //    insertion order (NOT id-sorted). Ids are deliberately non-lexicographic.
  {
    name: 'ambiguous-bucket',
    rule: baseRule({
      id: 'r_hit',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: { nodes: [{ ...N('R0', 'HIT'), mapFrom: 'L0' }], edges: [] },
    }),
    graph: {
      nodes: [N('z', 'A'), N('a', 'A'), N('m', 'A')], // insertion order z,a,m → picks z
      edges: [],
    },
  },

  // 3. A -r-> B with many A's and one B. Seed = B (rarest). Then the A neighbour
  //    is chosen in incident-edge insertion order, skipping the reversed edge
  //    (b->a4) that fails the directed-orientation constraint. Expected: a2.
  {
    name: 'seed-rarest-neighbor',
    rule: baseRule({
      id: 'r_ab',
      lhs: {
        nodes: [N('L0', 'A'), N('L1', 'B')],
        edges: [E('LE', 'L0', 'L1', 'r', true)],
      },
      rhs: {
        nodes: [{ ...N('R0', 'HIT'), mapFrom: 'L0' }, { ...N('R1', 'B'), mapFrom: 'L1' }],
        edges: [], // the matched edge is deleted (stable id → still comparable)
      },
    }),
    graph: {
      nodes: [N('a1', 'A'), N('a2', 'A'), N('a3', 'A'), N('a4', 'A'), N('b1', 'B')],
      edges: [
        E('e_rev', 'b1', 'a4', 'r'), // first incident on b1, but wrong orientation → skipped
        E('e_a2', 'a2', 'b1', 'r'),  // first VALID neighbour → selected
        E('e_a3', 'a3', 'b1', 'r'),
        E('e_a1', 'a1', 'b1', 'r'),
      ],
    },
  },

  // 4. Predicate filtering + selection: pick the FIRST A with w > 5 in bucket
  //    order. a1(w=3) fails, a2(w=9) is the first to pass.
  {
    name: 'predicate-select',
    rule: baseRule({
      id: 'r_pred',
      lhs: {
        nodes: [{ ...N('L0', 'A'), predicates: [{ key: 'w', op: 'gt', value: 5 }] }],
        edges: [],
      },
      rhs: { nodes: [{ ...N('R0', 'HIT'), mapFrom: 'L0' }], edges: [] },
    }),
    graph: {
      nodes: [N('a1', 'A', { w: 3 }), N('a2', 'A', { w: 9 }), N('a3', 'A', { w: 7 })],
      edges: [],
    },
  },

  // --- Seeded (RNG-parity) fixtures -----------------------------------------
  // These take the STOCHASTIC path: findOneMatch(rng) + applyRule({ rng }), and
  // assert bit-for-bit parity of Mulberry32 selection and random PropExprs.

  // 5. Stochastic match: a single-node pattern over many A's; iterRandom (the
  //    seed-bucket walk, consuming 2 draws) selects one A to relabel.
  {
    name: 'stochastic-match',
    seed: 42,
    rule: baseRule({
      id: 'r_pick',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: { nodes: [{ ...N('R0', 'HIT'), mapFrom: 'L0' }], edges: [] },
    }),
    graph: { nodes: [N('a0', 'A'), N('a1', 'A'), N('a2', 'A'), N('a3', 'A'), N('a4', 'A')], edges: [] },
  },

  // 6. Stochastic neighbour: seed = B (bucket size 1 → no draw), then the A
  //    neighbour is chosen by Fisher-Yates shuffle (consuming len-1 draws).
  {
    name: 'stochastic-neighbor',
    seed: 7,
    rule: baseRule({
      id: 'r_ab_rng',
      lhs: { nodes: [N('L0', 'A'), N('L1', 'B')], edges: [E('LE', 'L0', 'L1', 'r', true)] },
      rhs: {
        nodes: [{ ...N('R0', 'HIT'), mapFrom: 'L0' }, { ...N('R1', 'B'), mapFrom: 'L1' }],
        edges: [],
      },
    }),
    graph: {
      nodes: [N('a1', 'A'), N('a2', 'A'), N('a3', 'A'), N('a4', 'A'), N('b1', 'B')],
      edges: [E('e1', 'a1', 'b1', 'r'), E('e2', 'a2', 'b1', 'r'), E('e3', 'a3', 'b1', 'r'), E('e4', 'a4', 'b1', 'r')],
    },
  },

  // 7. Random PropExprs on a preserved (stable-id) node: two randInt then a
  //    randFloat, in setProps insertion order ,asserts value AND order parity.
  {
    name: 'rand-props',
    seed: 123,
    rule: baseRule({
      id: 'r_rand',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: {
        nodes: [{
          ...N('R0', 'A'),
          mapFrom: 'L0',
          setProps: {
            a: { kind: 'randInt', min: 10, max: 99 },
            b: { kind: 'randInt', min: 100, max: 999 },
            f: { kind: 'randFloat', min: 0, max: 1 },
          },
        }],
        edges: [],
      },
    }),
    graph: { nodes: [N('only', 'A')], edges: [] },
  },

  // 8. Composition: stochastic match (shuffle draws) THEN a randInt on the
  //    chosen node ,proves match + rewrite share one RNG stream in order.
  {
    name: 'stochastic-then-rand',
    seed: 99,
    rule: baseRule({
      id: 'r_pick_rand',
      lhs: { nodes: [N('L0', 'A'), N('L1', 'B')], edges: [E('LE', 'L0', 'L1', 'r', true)] },
      rhs: {
        nodes: [
          { ...N('R0', 'HIT'), mapFrom: 'L0', setProps: { k: { kind: 'randInt', min: 1, max: 1000 } } },
          { ...N('R1', 'B'), mapFrom: 'L1' },
        ],
        edges: [],
      },
    }),
    graph: {
      nodes: [N('a1', 'A'), N('a2', 'A'), N('a3', 'A'), N('b1', 'B')],
      edges: [E('e1', 'a1', 'b1', 'r'), E('e2', 'a2', 'b1', 'r'), E('e3', 'a3', 'b1', 'r')],
    },
  },

  // --- regex predicate + element-creation fixtures --------------------------

  // 9. regex predicate: ^a.+t$ matches 'ant' but not 'cat'/'dog'.
  {
    name: 'regex-select',
    rule: baseRule({
      id: 'r_re',
      lhs: { nodes: [{ ...N('L0', 'Node'), predicates: [{ key: 'name', op: 'regex', value: '^a.+t$' }] }], edges: [] },
      rhs: { nodes: [{ ...N('R0', 'HIT'), mapFrom: 'L0' }], edges: [] },
    }),
    graph: { nodes: [N('n1', 'Node', { name: 'cat' }), N('n2', 'Node', { name: 'ant' }), N('n3', 'Node', { name: 'dog' })], edges: [] },
  },

  // 10. Node + edge creation: A gains a new B child (compared up to id-renaming).
  {
    name: 'create-child',
    rule: baseRule({
      id: 'r_child',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: { nodes: [{ ...N('R0', 'A'), mapFrom: 'L0' }, N('R1', 'B')], edges: [E('RE', 'R0', 'R1', 'child', true)] },
    }),
    graph: { nodes: [N('a1', 'A'), N('c1', 'C')], edges: [E('e1', 'a1', 'c1', 'rel')] },
  },

  // 11. Seeded creation: the new node carries a randInt prop (value + jitter draws).
  {
    name: 'create-seeded',
    seed: 55,
    rule: baseRule({
      id: 'r_child_rng',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: {
        nodes: [{ ...N('R0', 'A'), mapFrom: 'L0' }, { ...N('R1', 'B'), setProps: { v: { kind: 'randInt', min: 1, max: 100 } } }],
        edges: [E('RE', 'R0', 'R1', 'child', true)],
      },
    }),
    graph: { nodes: [N('only', 'A')], edges: [] },
  },

  // 12. Deletion: the matched A (and its dangling edge) is removed.
  {
    name: 'delete-node',
    rule: baseRule({
      id: 'r_del',
      lhs: { nodes: [N('L0', 'A')], edges: [] },
      rhs: { nodes: [], edges: [] },
    }),
    graph: { nodes: [N('a1', 'A'), N('b1', 'B')], edges: [E('e1', 'a1', 'b1', 'rel')] },
  },
]

// Multi-step engine runs ,each exercises the step loop (rule selection,
// probability gates, the chosen strategy) and asserts the final graph + applied
// count match the real engine. Relabel-only so output is exactly comparable.
const engineFixtures: EngineFixture[] = [
  // random: weighted choice between two applicable rules + stochastic match.
  {
    name: 'engine-random',
    grammar: {
      rules: [relabelRule('r_ab', 'A', 'B', { weight: 2 }), relabelRule('r_ac', 'A', 'C', { weight: 1 })],
      config: cfg('random', 5, 4),
      start: { nodes: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'].map((id) => N(id, 'A')), edges: [] },
    },
  },
  // priority: higher-priority B→C fires whenever a B exists, else A→B.
  {
    name: 'engine-priority',
    grammar: {
      rules: [relabelRule('r_bc', 'B', 'C', { priority: 2 }), relabelRule('r_ab', 'A', 'B', { priority: 1 })],
      config: cfg('priority', 9, 5),
      start: { nodes: ['a0', 'a1', 'a2', 'a3'].map((id) => N(id, 'A')), edges: [] },
    },
  },
  // sequential: round-robin over the rule list via seqPtr.
  {
    name: 'engine-sequential',
    grammar: {
      rules: [relabelRule('r_ab', 'A', 'B'), relabelRule('r_bc', 'B', 'C')],
      config: cfg('sequential', 3, 5),
      start: { nodes: ['a0', 'a1', 'a2'].map((id) => N(id, 'A')), edges: [] },
    },
  },
  // maximal: shuffle all A–A pairs, apply a non-overlapping subset in one step.
  {
    name: 'engine-maximal',
    grammar: {
      rules: [baseRule({
        id: 'r_pair',
        lhs: { nodes: [N('L0', 'A'), N('L1', 'A')], edges: [E('LE', 'L0', 'L1', 'e', false)] },
        rhs: { nodes: [{ ...N('R0', 'X'), mapFrom: 'L0' }, { ...N('R1', 'Y'), mapFrom: 'L1' }], edges: [] },
      })],
      config: cfg('maximal', 11, 1),
      start: {
        nodes: ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => N(id, 'A')),
        edges: [E('e12', 'a1', 'a2', 'e', false), E('e23', 'a2', 'a3', 'e', false), E('e34', 'a3', 'a4', 'e', false), E('e45', 'a4', 'a5', 'e', false)],
      },
    },
  },
  // probability: a 0.5 rule ,some steps are no-op skips that the run loop retries.
  {
    name: 'engine-probability',
    grammar: {
      rules: [relabelRule('r_ab', 'A', 'B', { probability: 0.5 })],
      config: cfg('random', 17, 10),
      start: { nodes: ['a0', 'a1', 'a2', 'a3', 'a4'].map((id) => N(id, 'A')), edges: [] },
    },
  },
  // generative: each A spawns a child A; node-cap (maxNodes) halts growth. Tests
  // creation across steps + nodeDelta/fitsNodeBudget + created-id parity.
  {
    name: 'engine-generative',
    grammar: {
      rules: [baseRule({
        id: 'r_grow',
        lhs: { nodes: [N('L0', 'A')], edges: [] },
        rhs: { nodes: [{ ...N('R0', 'A'), mapFrom: 'L0' }, N('R1', 'A')], edges: [E('RE', 'R0', 'R1', 'c', true)] },
      })],
      config: { strategy: 'random', seed: 13, maxSteps: 50, maxNodes: 6 },
      start: { nodes: [N('root', 'A')], edges: [] },
    },
  },
]

function generate (fx: Fixture) {
  const host = new GraphIndex(structuredClone(fx.graph))

  // Compose match + rewrite exactly as gg_apply_rule[_seeded] does: when seeded,
  // a single RNG drives stochastic match selection THEN the rewrite, in order.
  let match: any
  if (fx.seed != null) {
    const rng = new RNG(fx.seed)
    match = findOneMatch(fx.rule.id, fx.rule.lhs, host, rng)
    if (!match) throw new Error(`fixture ${fx.name}: expected a match`)
    applyRule(host, fx.rule as any, match, { rng, counter: { value: 0 } })
  } else {
    const matches = findMatches(fx.rule.id, fx.rule.lhs, host, { limit: 1 })
    if (matches.length === 0) throw new Error(`fixture ${fx.name}: expected a match`)
    match = matches[0]
    // No seed → deterministic path; the rng here is never consumed.
    applyRule(host, fx.rule as any, match, { rng: new RNG(1), counter: { value: 0 } })
  }
  const expected = host.toGraph()

  const input: any = { rule: fx.rule, graph: fx.graph }
  if (fx.seed != null) input.seed = fx.seed
  writeFileSync(join(outDir, `${fx.name}.input.json`), JSON.stringify(input, null, 2) + '\n')
  writeFileSync(join(outDir, `${fx.name}.expected.json`), JSON.stringify(expected, null, 2) + '\n')

  const tag = fx.seed != null ? ` seed=${fx.seed}` : ''
  console.log(`✓ ${fx.name}${tag}: matched ${JSON.stringify(match.nodeMap)} → ${expected.nodes.length} nodes, ${expected.edges.length} edges`)
}

function generateEngine (fx: EngineFixture) {
  // GrammarSchema requires id/name; the fixtures only specify the interesting
  // parts, so fill them in to keep each a fully valid Grammar.
  const grammar = { id: fx.name, name: fx.name, ...fx.grammar }
  // Engine clones the start internally, so grammar is safe to reuse for input.
  const engine = new Engine(structuredClone(grammar))
  const applied = engine.run() // no arg → config.maxSteps
  const g = engine.graph

  writeFileSync(join(outDir, `${fx.name}.input.json`), JSON.stringify({ grammar }, null, 2) + '\n')
  writeFileSync(
    join(outDir, `${fx.name}.expected.json`),
    JSON.stringify({ nodes: g.nodes, edges: g.edges, applied }, null, 2) + '\n'
  )
  console.log(`✓ ${fx.name} [${fx.grammar.config.strategy}]: ${applied} steps applied → ${g.nodes.length} nodes, ${g.edges.length} edges`)
}

for (const fx of fixtures) generate(fx)
for (const fx of engineFixtures) generateEngine(fx)
console.log(`\n${fixtures.length + engineFixtures.length} fixtures written to`, outDir)
