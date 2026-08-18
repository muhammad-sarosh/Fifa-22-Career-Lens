import { describe, expect, it } from 'vitest'
import { fixturePlayers } from './data'
import { defaultPresets, formatRating, scoreForPreset } from './scoring'
import { attributeKeys } from './types'

describe('position scoring', () => {
  it('returns a score range when attributes are ranged', () => {
    const result = scoreForPreset(fixturePlayers[1], defaultPresets.WINGER)
    expect(result.score).not.toBeNull()
    expect(result.score!.min).toBeLessThan(result.score!.max)
    expect(result.coverage).toBeGreaterThan(50)
  })

  it('reports coverage so incomplete scouting is never presented as certainty', () => {
    const result = scoreForPreset(fixturePlayers[0], defaultPresets.WINGER)
    expect(result.coverage).toBeLessThanOrEqual(100)
    expect(result.coverage).toBeGreaterThan(0)
  })

  it('ships the complete 0–10 position table as factory defaults', () => {
    expect(Object.keys(defaultPresets.ST.weights)).toHaveLength(attributeKeys.length)
    expect(defaultPresets.ST.weights.finishing).toBe(10)
    expect(defaultPresets.CM.weights.shortPassing).toBe(10)
    expect(defaultPresets.GK.weights.gkReflexes).toBe(10)
  })

  it('formats scouting ranges with readable spacing', () => {
    expect(formatRating({ min: 68, max: 78 })).toBe('68 – 78')
  })
})
