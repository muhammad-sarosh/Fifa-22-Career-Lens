import { describe, expect, it } from 'vitest'
import { parsePlayerCsv } from './csv'

describe('knowledge-safe CSV import', () => {
  it('preserves exact values and ranges', () => {
    const result = parsePlayerCsv('playerid,name,scope,ovr,acceleration,sprint_speed,vision\n1,Known Player,My squad,74,88,90,76\n2,Scouted Player,Scouting,71-75,80-86,82-88,66-72')
    expect(result.players).toHaveLength(2)
    expect(result.players[0].knowledge).toBe('Exact')
    expect(result.players[1].knowledge).toBe('Ranged')
    expect(result.players[1].attributes.sprintSpeed).toEqual({ min: 82, max: 88 })
  })

  it('keeps unavailable values unknown instead of inventing ratings', () => {
    const player = parsePlayerCsv('id,name,scope,acceleration,vision\n1,Unscouted Player,Player search,,').players[0]
    expect(player.knowledge).toBe('Unknown')
    expect(player.attributes.acceleration).toBeNull()
    expect(player.attributes.vision).toBeNull()
  })

  it('supports separate minimum and maximum exporter columns', () => {
    const player = parsePlayerCsv('id,name,dribbling_min,dribbling_max,value_min,value_max\n1,Range Player,75,83,4000000,6000000').players[0]
    expect(player.attributes.dribbling).toEqual({ min: 75, max: 83 })
    expect(player.value).toEqual({ min: 4_000_000, max: 6_000_000 })
  })
})
