import type { Player } from './types'

function searchableText(player: Player): string {
  return [player.name, player.club, ...player.positions].join(' ').toLocaleLowerCase()
}

export function playerMatchesSearch(player: Player, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const text = searchableText(player)
  return terms.every((term) => text.includes(term))
}
