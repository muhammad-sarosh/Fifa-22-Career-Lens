import { describe, expect, it } from 'vitest'
import { emptyAttributes } from './scoring'
import { playerMatchesPositions, playerMatchesSearch } from './search'
import type { Player } from './types'

const ndiaye: Player = {
  id: '237179', name: 'Cherif Ndiaye', club: 'Frens FC', age: 26,
  positions: ['ST', 'LW'], preferredFoot: 'Right', overall: { min: 74, max: 74 },
  potential: null, value: null, wage: null, scope: 'My squad', shortlisted: false, scouting: false, knowledge: 'Exact', attributes: emptyAttributes(),
}

describe('playerMatchesSearch', () => {
  it.each(['frens fc ndiaye', 'ndiaye frens fc', 'frens ndiaye', 'cherif st'])('matches unordered player and club terms: %s', (query) => {
    expect(playerMatchesSearch(ndiaye, query)).toBe(true)
  })

  it('requires every search term to match', () => {
    expect(playerMatchesSearch(ndiaye, 'frens ramos')).toBe(false)
  })

  it('matches names without requiring their diacritics', () => {
    const player = { ...ndiaye, name: 'Cléber Conceição', club: 'São Paulo' }
    expect(playerMatchesSearch(player, 'cleber conceicao')).toBe(true)
    expect(playerMatchesSearch(player, 'sao paulo cleber')).toBe(true)
  })

  it('matches any of the selected positions', () => {
    expect(playerMatchesPositions(ndiaye, ['CAM', 'ST'])).toBe(true)
    expect(playerMatchesPositions(ndiaye, ['CAM', 'CM'])).toBe(false)
    expect(playerMatchesPositions(ndiaye, [])).toBe(true)
  })
})
