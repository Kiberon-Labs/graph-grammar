import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'

// Serves /llms.txt (https://llmstxt.org/): a curated, LLM-friendly index of the
// docs. Generated from the docs content collection so it stays in sync, and
// grouped to mirror the sidebar. Prerendered to a static file at build time.
export const prerender = true

const TITLE = 'Graph Grammar'
const SUMMARY =
  'A fast, framework-agnostic graph rewriting / graph grammar engine for TypeScript.'
const AUTHOR = { name: 'Kiberon Labs', url: 'https://kiberonlabs.com' }

// Section grouping + ordering, mirroring the Starlight sidebar. Pages not listed
// here still appear (sorted after known ones) so new docs are never dropped.
const SECTIONS: Array<{ title: string, match: (id: string) => boolean }> = [
  { title: 'Start here', match: (id) => id === 'introduction' || id === 'getting-started' },
  { title: 'Explanation', match: (id) => id.startsWith('explanation/') },
  { title: 'Guides', match: (id) => id.startsWith('guides/') },
  { title: 'Reference', match: (id) => id.startsWith('reference/') },
]
const ORDER = [
  'introduction',
  'getting-started',
  'explanation/concepts',
  'explanation/matching',
  'guides/authoring-rules',
  'guides/strategies',
  'guides/serialization',
  'guides/embedding-the-editor',
  'guides/custom-node-rendering',
  'reference/api',
]

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL // always begins and ends with '/'
  const pageUrl = (id: string) => {
    const path = id ? `${base}${id}/` : base
    return site ? new URL(path, site).href : path
  }
  const weight = (id: string) => {
    const i = ORDER.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }

  const docs = (await getCollection('docs'))
    // Drop the splash landing page (empty id) ,it has no standalone content.
    .filter((entry) => entry.id !== '' && entry.id !== 'index')
    .sort((a, b) => weight(a.id) - weight(b.id) || a.data.title.localeCompare(b.data.title))

  const lines = [`# ${TITLE}`, '', `> ${SUMMARY}`, '']
  lines.push(`Documentation for the graph-grammar engine, authored and maintained by [${AUTHOR.name}](${AUTHOR.url}).`, '')

  const used = new Set<string>()
  const renderItem = (entry: (typeof docs)[number]) => {
    const desc = entry.data.description ? `: ${entry.data.description}` : ''
    return `- [${entry.data.title}](${pageUrl(entry.id)})${desc}`
  }

  for (const section of SECTIONS) {
    const items = docs.filter((e) => section.match(e.id))
    if (items.length === 0) continue
    lines.push(`## ${section.title}`)
    for (const entry of items) {
      lines.push(renderItem(entry))
      used.add(entry.id)
    }
    lines.push('')
  }

  // Any pages not captured by a section above.
  const rest = docs.filter((e) => !used.has(e.id))
  if (rest.length > 0) {
    lines.push('## Other')
    for (const entry of rest) lines.push(renderItem(entry))
    lines.push('')
  }

  return new Response(lines.join('\n').trimEnd() + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
