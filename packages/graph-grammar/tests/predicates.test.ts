import { describe, it, expect } from 'vitest'
import { evalPredicate } from '../src/match.ts'

describe('property predicates', () => {
  it('compares numbers', () => {
    expect(evalPredicate({ a: 5 }, { key: 'a', op: 'gt', value: 3 })).toBe(true)
    expect(evalPredicate({ a: 2 }, { key: 'a', op: 'gt', value: 3 })).toBe(false)
    expect(evalPredicate({ a: 5 }, { key: 'a', op: 'lte', value: 5 })).toBe(true)
  })

  it('matches strings (contains / regex)', () => {
    expect(evalPredicate({ s: 'hello' }, { key: 's', op: 'contains', value: 'ell' })).toBe(true)
    expect(evalPredicate({ s: 'abc123' }, { key: 's', op: 'regex', value: '\\d+' })).toBe(true)
  })

  it('checks existence and membership', () => {
    expect(evalPredicate({ x: 1 }, { key: 'x', op: 'exists' })).toBe(true)
    expect(evalPredicate({}, { key: 'x', op: 'absent' })).toBe(true)
    expect(evalPredicate({ c: 'b' }, { key: 'c', op: 'in', value: ['a', 'b', 'c'] })).toBe(true)
    expect(evalPredicate({ c: 'z' }, { key: 'c', op: 'in', value: ['a', 'b'] })).toBe(false)
  })

  it('treats a numeric comparison against a string as false', () => {
    expect(evalPredicate({ a: '5' }, { key: 'a', op: 'gt', value: 3 })).toBe(false)
  })
})
