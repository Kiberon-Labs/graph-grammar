import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import reactHooks from 'eslint-plugin-react-hooks'

// House style: ESLint v9 flat config + neostandard (the `standard` lineage —
// no semicolons, 2-space indent, single quotes). neostandard's style rules
// double as the formatter, so there is no separate Prettier step.
export default [
  ...neostandard({
    // Lint .ts/.tsx/.d.ts in addition to JS; JSX rules are on by default.
    ts: true,
    // Reuse .gitignore so build output (dist/, .astro/, _site/) is skipped.
    ignores: resolveIgnoresFromGitignore()
  }),
  // React Hooks rules for the editor package's components.
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
]
