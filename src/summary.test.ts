import { describe, expect, it } from 'vitest'
import { emptyAttributes } from './scoring'
import { averageRating, summaryCategories } from './summary'
import type { Player } from './types'

describe('FIFA scout summary categories', () => {
  it('reproduces the displayed Cherif Ndiaye summaries', () => {
    const attributes = emptyAttributes()
    const values = { ballControl: 78, dribbling: 69, crossing: 55, shortPassing: 75, longPassing: 50, finishing: 77, headingAccuracy: 75, volleys: 59, curve: 41, freeKickAccuracy: 33, penalties: 66, acceleration: 74, sprintSpeed: 79, agility: 70, balance: 66, reactions: 77, shotPower: 72, jumping: 75, stamina: 77, strength: 84, longShots: 52, aggression: 76, interceptions: 21, attackingPosition: 70, vision: 54, composure: 63, marking: 44, standingTackle: 33, slidingTackle: 24 } as const
    for (const [key, value] of Object.entries(values)) attributes[key as keyof typeof attributes] = { min: value, max: value }
    const player = { attributes } as Player
    const results = Object.fromEntries(summaryCategories.map((category) => [category.name, averageRating(player, category.keys, category.rounding, category.weights)?.min]))
    expect(results).toEqual({ Athleticism: 75, 'Technical ability': 59, Shooting: 65, Passing: 60, Defending: 33, Mentality: 56 })
  })

  it('matches Zaydou Youssouf’s displayed passing summary', () => {
    const attributes = emptyAttributes()
    attributes.crossing = { min: 65, max: 65 }
    attributes.shortPassing = { min: 78, max: 78 }
    attributes.longPassing = { min: 75, max: 75 }
    attributes.vision = { min: 73, max: 73 }
    const passing = summaryCategories.find((category) => category.name === 'Passing')!
    expect(averageRating({ attributes } as Player, passing.keys, passing.rounding, passing.weights)?.min).toBe(72)
  })
})
