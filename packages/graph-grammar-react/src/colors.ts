// Deterministic colour assignment for node labels so the same symbol always
// renders the same colour across the host graph and the rule editors.

const PALETTE = [
  '#4dabf7', '#69db7c', '#ffd43b', '#ff8787', '#b197fc',
  '#3bc9db', '#ffa94d', '#f783ac', '#a9e34b', '#63e6be',
  '#74c0fc', '#ffe066', '#ff6b6b', '#9775fa', '#38d9a9',
  '#e599f7', '#ffc078', '#8ce99a', '#66d9e8', '#fcc2d7',
]

const cache = new Map<string, string>()

function hash (str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function labelColor (label: string): string {
  if (!label || label === '*') return '#868e96' // wildcard grey
  let c = cache.get(label)
  if (!c) {
    c = PALETTE[hash(label) % PALETTE.length]
    cache.set(label, c)
  }
  return c
}

/** A darker variant for strokes/text. */
export function darken (hex: string, amount = 0.35): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  r = Math.round(r * (1 - amount))
  g = Math.round(g * (1 - amount))
  b = Math.round(b * (1 - amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Readable text colour (black/white) for a given background. */
export function textOn (hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1a1d23' : '#ffffff'
}
