import { z } from 'zod'
import type { Grammar, Graph, GNode, GEdge } from './types.ts'
import { GrammarSchema, GraphSchema } from './schema.ts'
import { makeNode, makeEdge, emptyGraph } from './graph.ts'

// ============================================================================
// Import / export. The native format is JSON. We also parse a few convenient
// textual graph formats so a user can paste a graph quickly while testing.
// ============================================================================

export function exportGrammar (g: Grammar): string {
  return JSON.stringify(g, null, 2)
}

/**
 * Coerce a loosely-shaped grammar object into a fully-formed one by filling in
 * the optional top-level fields the older formats / partial pastes may omit,
 * then validating the result against the schema. Throws a descriptive error
 * (see {@link formatError}) when the input cannot be made valid.
 */
export function importGrammar (text: string): Grammar {
  const raw = JSON.parse(text)
  // back-fill the fields that have always been optional in the on-disk format
  if (raw && typeof raw === 'object') {
    if (!raw.rules) raw.rules = []
    if (!raw.config) raw.config = { strategy: 'random', seed: 1, maxSteps: 200, maxNodes: 0 }
    if (!raw.start) raw.start = emptyGraph()
  }
  const parsed = GrammarSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`Invalid grammar: ${formatError(parsed.error)}`)
  return parsed.data
}

/**
 * Non-throwing variant of {@link importGrammar}. Returns a discriminated result
 * so callers (e.g. the UI import flow) can surface a precise message instead of
 * a generic "import failed".
 */
export function safeImportGrammar (
  text: string
): { ok: true; grammar: Grammar } | { ok: false; error: string } {
  try {
    return { ok: true, grammar: importGrammar(text) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Render a zod error as a compact `path: message; …` string. */
function formatError (err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

export function exportGraph (g: Graph): string {
  return JSON.stringify(g, null, 2)
}

/**
 * Parse a graph from one of several text formats, auto-detected:
 *   - JSON ({ nodes, edges })
 *   - Edge list:  `A -> B`  / `A -- B`  / `A B`  with optional `:label`
 *   - DOT-lite:   `digraph { A -> B [label=x]; B -> C }`
 * Node labels are taken from the token; ids are generated. Repeated tokens map
 * to the same node.
 */
export function parseGraph (text: string): Graph {
  const trimmed = text.trim()
  if (!trimmed) return emptyGraph()
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj && obj.nodes && obj.edges) {
        // If it's already a well-formed graph, take it verbatim; otherwise run
        // the lenient normalizer (coerces ids to strings, defaults props, etc.).
        const strict = GraphSchema.safeParse(obj)
        return strict.success ? strict.data : normalizeGraph(obj)
      }
    } catch {
      /* fall through to text parsers */
    }
  }
  if (/^\s*(di)?graph\b/i.test(trimmed) || trimmed.includes('->') || trimmed.includes('--')) {
    return parseEdgeList(trimmed)
  }
  return parseEdgeList(trimmed)
}

function normalizeGraph (obj: any): Graph {
  const nodes: GNode[] = (obj.nodes ?? []).map((n: any) => ({
    id: String(n.id),
    label: String(n.label ?? n.type ?? 'node'),
    props: n.props ?? {},
    x: n.x,
    y: n.y,
  }))
  const ids = new Set(nodes.map((n) => n.id))
  const edges: GEdge[] = (obj.edges ?? obj.links ?? [])
    .map((e: any) => ({
      id: String(e.id ?? `${e.source}-${e.target}`),
      source: String(e.source),
      target: String(e.target),
      label: String(e.label ?? ''),
      props: e.props ?? {},
      directed: e.directed ?? true,
    }))
    .filter((e: GEdge) => ids.has(e.source) && ids.has(e.target))
  return { nodes, edges }
}

function parseEdgeList (text: string): Graph {
  const g = emptyGraph()
  const idByName = new Map<string, string>()
  const ensure = (name: string): string => {
    name = name.trim()
    let id = idByName.get(name)
    if (!id) {
      // label is the alphabetic prefix; e.g. "A1" → label "A"? Keep full token
      // as label but strip a trailing _id suffix style. Simpler: label = name's
      // leading non-digits if present else the whole name.
      const m = name.match(/^([A-Za-z_]+)/)
      const label = m ? m[1] : name
      const node = makeNode(label, name !== label ? { name } : {})
      g.nodes.push(node)
      idByName.set(name, node.id)
      id = node.id
    }
    return id
  }

  const lines = text
    .replace(/^\s*(di)?graph\s*\w*\s*\{/i, '')
    .replace(/\}\s*$/, '')
    .split(/[\n;]+/)

  for (const raw of lines) {
    let line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    // optional [label=...] bracket
    let edgeLabel = ''
    const br = line.match(/\[(.*?)\]/)
    if (br) {
      const lm = br[1].match(/label\s*=\s*"?([^",\]]+)"?/i)
      if (lm) edgeLabel = lm[1].trim()
      line = line.replace(/\[.*?\]/, '').trim()
    }
    const directed = line.includes('->')
    const parts = line.split(/->|--|\s+/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 1) {
      ensure(parts[0]) // isolated node
    } else {
      for (let i = 0; i < parts.length - 1; i++) {
        const s = ensure(parts[i])
        const t = ensure(parts[i + 1])
        g.edges.push(makeEdge(s, t, edgeLabel, directed))
      }
    }
  }
  return g
}

/** Build a random graph for quick testing. */
export function randomGraph (nodeCount: number, edgeFactor: number, labels: string[]): Graph {
  const g = emptyGraph()
  for (let i = 0; i < nodeCount; i++) {
    g.nodes.push(makeNode(labels[i % labels.length], {}, Math.random() * 800, Math.random() * 600))
  }
  const edgeCount = Math.floor(nodeCount * edgeFactor)
  for (let i = 0; i < edgeCount; i++) {
    const a = g.nodes[Math.floor(Math.random() * g.nodes.length)]
    const b = g.nodes[Math.floor(Math.random() * g.nodes.length)]
    if (a.id !== b.id) g.edges.push(makeEdge(a.id, b.id, '', true))
  }
  return g
}

/** A grid graph , handy for testing maximal/parallel rewriting. */
export function gridGraph (cols: number, rows: number, label = 'A'): Graph {
  const g = emptyGraph()
  const id: string[][] = []
  for (let r = 0; r < rows; r++) {
    id[r] = []
    for (let c = 0; c < cols; c++) {
      const n = makeNode(label, {}, c * 80 + 60, r * 80 + 60)
      g.nodes.push(n)
      id[r][c] = n.id
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) g.edges.push(makeEdge(id[r][c], id[r][c + 1], '', false))
      if (r + 1 < rows) g.edges.push(makeEdge(id[r][c], id[r + 1][c], '', false))
    }
  }
  return g
}
