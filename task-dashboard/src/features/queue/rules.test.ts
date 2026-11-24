import { describe, it, expect } from 'vitest'
import { countResolutionChars, MIN_RESOLUTION_CHARS, canMoveTo } from '../queue/rules'

describe('BR-02 resolution notes rule', () => {
  it('counts only ASCII letters and digits', () => {
    expect(countResolutionChars('abc123')).toBe(6)
    expect(countResolutionChars('áéíóúñ')).toBe(0) // accented letters do NOT count
    expect(countResolutionChars('Hello World 123')).toBe(13) // space ignored
    expect(countResolutionChars('')).toBe(0)
  })

  it('requires at least 20 alphanumeric chars to resolve', () => {
    const short = 'abc123' // 6 chars
    const long = 'This is a valid resolution note with enough chars' // > 20
    expect(countResolutionChars(short)).toBeLessThan(MIN_RESOLUTION_CHARS)
    expect(countResolutionChars(long)).toBeGreaterThanOrEqual(MIN_RESOLUTION_CHARS)
  })

  it('MIN_RESOLUTION_CHARS is 20', () => {
    expect(MIN_RESOLUTION_CHARS).toBe(20)
  })
})

describe('BR-01/BR-03 transition rules', () => {
  it('OPEN can move to ASSIGNED', () => {
    expect(canMoveTo('OPEN', 'ASSIGNED')).toBe(true)
  })

  it('CLOSED is terminal (no transitions)', () => {
    expect(canMoveTo('CLOSED', 'OPEN')).toBe(false)
    expect(canMoveTo('CLOSED', 'RESOLVED')).toBe(false)
  })

  it('RESOLVED can move to CLOSED or REOPENED', () => {
    expect(canMoveTo('RESOLVED', 'CLOSED')).toBe(true)
    expect(canMoveTo('RESOLVED', 'REOPENED')).toBe(true)
  })

  it('ASSIGNED can move to IN_PROGRESS or RESOLVED', () => {
    expect(canMoveTo('ASSIGNED', 'IN_PROGRESS')).toBe(true)
    expect(canMoveTo('ASSIGNED', 'RESOLVED')).toBe(true)
    expect(canMoveTo('ASSIGNED', 'CLOSED')).toBe(false)
  })
})