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

  it('imports youth academy potential as a visible range', () => {
    const player = parsePlayerCsv('playerid,name,scope,knowledge,overall,potential,value,acceleration\n1,Alex Ferreira,Youth academy,Exact,67,83-94,,78').players[0]
    expect(player.scope).toBe('Youth academy')
    expect(player.knowledge).toBe('Exact')
    expect(player.potential).toEqual({ min: 83, max: 94 })
    expect(player.value).toBeNull()
  })

  it('keeps scouting and shortlist membership independent', () => {
    const player = parsePlayerCsv('playerid,name,scope,shortlisted,scouting,knowledge,acceleration\n1,Dual Member,Shortlist,true,true,Exact,75').players[0]
    expect(player.shortlisted).toBe(true)
    expect(player.scouting).toBe(true)
  })

  it('imports the save currency and defaults external CSV files to dollars', () => {
    const sterling = parsePlayerCsv('playerid,name,currency,value\n1,Sterling Player,GBP,4400000').players[0]
    const external = parsePlayerCsv('playerid,name,value\n2,External Player,5000000').players[0]
    expect(sterling.currency).toBe('GBP')
    expect(external.currency).toBe('USD')
  })
})
