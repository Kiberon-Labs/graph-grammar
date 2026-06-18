// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// Deploy target is supplied by the GitHub Pages workflow via env, so this same
// config works for local dev (root), the canonical repo, and forks without edits:
//   PAGES_SITE , origin, e.g. https://kiberonlabs.github.io
//   PAGES_BASE , subpath the site is served from, e.g. /graph-grammar/
// Both unset locally → the site builds/serves at the root ("/").
const site = process.env.PAGES_SITE || undefined
// Normalise to a leading+trailing slash so the workflow can hand us
// configure-pages' base_path verbatim (it has no trailing slash).
let base = process.env.PAGES_BASE || '/'
if (!base.startsWith('/')) base = '/' + base
if (!base.endsWith('/')) base += '/'

// https://starlight.astro.build/reference/configuration/
export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: 'Graph Grammar',
      description:
        'A fast, framework-agnostic graph rewriting / graph grammar engine for TypeScript.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/kiberonlabs/graph-grammar' },
      ],
      components: {
        // Co-branded header logos (Kiberon Labs × graph-grammar) beside the title.
        SiteTitle: './src/components/SiteTitle.astro',
        // Append a "Made by Kiberon Labs" backlink below the default footer on
        // every page, without replacing Starlight's pagination / edit-link footer.
        Footer: './src/components/Footer.astro',
      },
      sidebar: [
        // External backlink to the company site. Starlight detects the absolute
        // URL and links out verbatim (no `base` prepended).
        { label: 'Kiberon Labs ↗', link: 'https://kiberonlabs.com', attrs: { target: '_blank', rel: 'noopener' } },
        // Base-relative; Starlight prepends the configured `base` → e.g. /graph-grammar/app/.
        // The demo app is assembled at <base>app/ by the Pages workflow.
        { label: 'Live demo ↗', link: '/app/', attrs: { target: '_blank', rel: 'noopener' } },
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Getting started', slug: 'getting-started' },
          ],
        },
        {
          label: 'Explanation',
          items: [
            { label: 'Core concepts', slug: 'explanation/concepts' },
            { label: 'Matching & complexity', slug: 'explanation/matching' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Authoring rules', slug: 'guides/authoring-rules' },
            { label: 'Application strategies', slug: 'guides/strategies' },
            { label: 'Serialization & validation', slug: 'guides/serialization' },
            { label: 'Embedding the editor', slug: 'guides/embedding-the-editor' },
            { label: 'Custom node rendering', slug: 'guides/custom-node-rendering' },
            { label: 'Planning & search', slug: 'guides/planning' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'API reference', slug: 'reference/api' }],
        },
      ],
    }),
  ],
})
