// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import sitemap from '@astrojs/sitemap'

// Kiberon Labs is the canonical author/publisher of the site. Surfaced as
// <meta>/<link> author tags and schema.org JSON-LD for search engines & LLMs.
const AUTHOR = { name: 'Kiberon Labs', url: 'https://kiberonlabs.com' }
const SITE_DESCRIPTION =
  'A fast, framework-agnostic graph rewriting / graph grammar engine for TypeScript.'

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
    // Explicitly owned (Starlight would otherwise add @astrojs/sitemap with
    // defaults). Only emits when `site` is set — provided by the Pages deploy.
    sitemap(),
    starlight({
      title: 'Graph Grammar',
      description: SITE_DESCRIPTION,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Kiberon-Labs/graph-grammar' },
        { icon: 'discord', label: 'Community Discord', href: 'https://discord.gg/99J9YSsHv' },
      ],
      // Point search engines / social cards / LLMs at Kiberon Labs as the
      // canonical author and publisher of the documentation.
      head: [
        { tag: 'meta', attrs: { name: 'author', content: AUTHOR.name } },
        { tag: 'meta', attrs: { name: 'publisher', content: AUTHOR.name } },
        { tag: 'link', attrs: { rel: 'author', href: AUTHOR.url } },
        { tag: 'meta', attrs: { property: 'og:site_name', content: 'Graph Grammar' } },
        {
          tag: 'script',
          attrs: { type: 'application/ld+json' },
          content: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Graph Grammar',
            description: SITE_DESCRIPTION,
            author: { '@type': 'Organization', name: AUTHOR.name, url: AUTHOR.url },
            publisher: { '@type': 'Organization', name: AUTHOR.name, url: AUTHOR.url },
          }),
        },
      ],
      components: {
        // Add per-page Open Graph / Twitter card images to the default <head>.
        Head: './src/components/Head.astro',
        // Default the site to dark mode (overrides only the no-preference
        // fallback; explicit light/dark/auto choices still win and persist).
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        // Co-branded header logos (Kiberon Labs × graph-grammar) beside the title.
        SiteTitle: './src/components/SiteTitle.astro',
        // Append a "Made by Kiberon Labs" backlink below the default footer on
        // every page, without replacing Starlight's pagination / edit-link footer.
        Footer: './src/components/Footer.astro',
      },
      sidebar: [
        // External backlink to the company site. Starlight detects the absolute
        // URL and links out verbatim (no `base` prepended).
        // Base-relative; Starlight prepends the configured `base` → e.g. /graph-grammar/app/.
        // The demo app is assembled at <base>app/ by the Pages workflow.
        { label: 'Live demo', link: '/app/', attrs: { target: '_blank', rel: 'noopener' } },
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
