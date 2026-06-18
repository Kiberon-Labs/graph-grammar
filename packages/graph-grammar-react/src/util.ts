import type { PropValue } from 'graph-grammar'

/** Parse a text field into a boolean / number / string, the way the inspectors
 *  expect (so "true"/"42" become typed values, everything else stays a string). */
export function coerce (v: string): PropValue {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  return v
}
