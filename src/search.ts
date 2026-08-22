import type { Player } from './types'

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
}

function searchableText(player: Player): string {
  return normalizeSearchText([player.name, player.club, ...player.positions].join(' '))
}

export function playerMatchesSearch(player: Player, query: string): boolean {
  const terms = normalizeSearchText(query.trim()).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const text = searchableText(player)
  return terms.every((term) => text.includes(term))
}

export function playerMatchesPositions(player: Player, positions: string[]): boolean {
  return positions.length === 0 || player.positions.some((position) => positions.includes(position))
}
