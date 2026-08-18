import { describe, expect, it } from 'vitest'
import { emptyAttributes } from './scoring'
import { playerMatchesSearch } from './search'
import type { Player } from './types'

const ndiaye: Player = {
  id: '237179', name: 'Cherif Ndiaye', club: 'Frens FC', age: 26,
  positions: ['ST', 'LW'], preferredFoot: 'Right', overall: { min: 74, max: 74 },
  value: null, wage: null, scope: 'My squad', knowledge: 'Exact', attributes: emptyAttributes(),
}

describe('playerMatchesSearch', () => {
  it.each(['frens fc ndiaye', 'ndiaye frens fc', 'frens ndiaye', 'cherif st'])('matches unordered player and club terms: %s', (query) => {
    expect(playerMatchesSearch(ndiaye, query)).toBe(true)
  })

  it('requires every search term to match', () => {
    expect(playerMatchesSearch(ndiaye, 'frens ramos')).toBe(false)
  })
})
