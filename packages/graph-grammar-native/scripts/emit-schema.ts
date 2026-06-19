/**
 * Single source of truth: emit JSON Schema from the engine's zod schemas.
 *
 *   npx tsx scripts/emit-schema.ts          # write schema/graph-grammar.schema.json
 *   npx tsx scripts/emit-schema.ts --check  # fail if the committed schema is stale
 *
 * The `GrammarSchema` transitively covers every type the native port consumes
 * (Rule, Graph, PatternGraph, PropExpr, …). We register each exported schema with
 * a stable `id` so reused types land in `$defs` under a SEMANTIC name (PropValue,
 * Rule, …) ,the downstream Rust codegen then produces one well-named type per
 * definition instead of duplicated, anonymous inline types.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Same zod instance the dist schemas were built with (tsup externalizes zod).
import { z } from '../../graph-grammar/node_modules/zod/index.js'
import * as gg from '../../graph-grammar/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outFile = join(here, '..', 'schema', 'graph-grammar.schema.json')

// Register every exported `*Schema` under its bare name so $defs keys are stable.
for (const [exportName, value] of Object.entries(gg)) {
  if (!exportName.endsWith('Schema')) continue
  const id = exportName.slice(0, -'Schema'.length)
  try {
    z.globalRegistry.add(value as any, { id })
  } catch {
    // already registered (idempotent re-runs) ,fine
  }
}

const schema: any = z.toJSONSchema(gg.GrammarSchema as any, {
  target: 'draft-2020-12',
  reused: 'ref',
})
schema.title = 'Grammar'
const json = JSON.stringify(schema, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = readFileSync(outFile, 'utf8')
  if (current !== json) {
    console.error('schema/graph-grammar.schema.json is stale ,run `npx tsx scripts/emit-schema.ts`')
    process.exit(1)
  }
  console.log('schema is in sync with the zod source.')
} else {
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, json)
  console.log('wrote', outFile)
  console.log('$defs:', Object.keys(schema.$defs ?? {}).join(', ') || '(none)')
}
