import { describe, expect, it } from 'vitest'
import { rubberBand } from './useElasticOverscroll'

const MAX_PULL_PX = 96

describe('rubberBand', () => {
  it('returns 0 at distance 0', () => {
    expect(rubberBand(0, 700)).toBe(0)
  })

  it('preserves the sign of the input distance', () => {
    expect(rubberBand(50, 700)).toBeGreaterThan(0)
    expect(rubberBand(-50, 700)).toBeLessThan(0)
  })

  it('increases monotonically with |distance|', () => {
    const extent = 700
    const samples = [0, 10, 30, 60, 100, 200, 400, 800, 2000]
    let prev = -Infinity
    for (const x of samples) {
      const b = rubberBand(x, extent)
      expect(b).toBeGreaterThanOrEqual(prev)
      prev = b
    }
  })

  it('never exceeds MAX_PULL_PX in magnitude', () => {
    for (const x of [100, 1000, 10000, 1e9]) {
      expect(Math.abs(rubberBand(x, 700))).toBeLessThanOrEqual(MAX_PULL_PX)
      expect(Math.abs(rubberBand(-x, 700))).toBeLessThanOrEqual(MAX_PULL_PX)
    }
  })

  it('matches the expected pull for a representative drag', () => {
    expect(rubberBand(100, 700)).toBeCloseTo(51, 0)
    expect(Math.abs(rubberBand(100, 700) - 51)).toBeLessThanOrEqual(2)
  })
})
