import { describe, it, expect } from 'vitest'
import { EXAMPLES, buildExample } from '../src/examples.ts'
import {
  exportGrammar,
  importGrammar,
  safeImportGrammar,
  parseGraph,
} from '../src/serialize.ts'
import { GrammarSchema, GraphSchema } from '../src/schema.ts'

describe('grammar schema', () => {
  it.each(EXAMPLES.map((e) => e.key))(
    'validates and round-trips the %s example',
    (key) => {
      const g = buildExample(key)
      // Every shipped example must satisfy the schema as-is.
      expect(GrammarSchema.safeParse(g).success).toBe(true)
      // export â†’ import must preserve the grammar (validated on the way in).
      const back = importGrammar(exportGrammar(g))
      expect(back).toEqual(g)
    }
  )

  it('back-fills the optional top-level fields', () => {
    const g = importGrammar(JSON.stringify({ id: 'x', name: 'n' }))
    expect(g.rules).toEqual([])
    expect(g.start).toEqual({ nodes: [], edges: [] })
    expect(g.config.strategy).toBe('random')
  })

  it('rejects structurally invalid grammars with a path-qualified message', () => {
    const bad = JSON.stringify({
      id: 'x',
      name: 'n',
      rules: [{ id: 'r', name: 'bad', enabled: 'yes' }],
    })
    const res = safeImportGrammar(bad)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/rules\.0/)
  })

  it('rejects an unknown application strategy', () => {
    const g = buildExample('triangle')
    const mutated = { ...g, config: { ...g.config, strategy: 'telepathic' } }
    expect(() => importGrammar(JSON.stringify(mutated))).toThrow(/strategy/)
  })
})

describe('parseGraph JSON branch', () => {
  it('accepts a well-formed graph verbatim', () => {
    const graph = { nodes: [{ id: '1', label: 'A', props: {} }], edges: [] }
    const parsed = parseGraph(JSON.stringify(graph))
    expect(GraphSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.nodes[0].id).toBe('1')
  })

  it('normalizes a loosely-shaped graph (numeric ids, missing props)', () => {
    const parsed = parseGraph(JSON.stringify({ nodes: [{ id: 1, label: 'A' }], edges: [] }))
    expect(parsed.nodes[0].id).toBe('1')
    expect(parsed.nodes[0].props).toEqual({})
  })
})
