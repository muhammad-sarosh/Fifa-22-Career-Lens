import type { AttributeKey, Player, RatingRange } from './types'

export const summaryCategories: { name: string; keys: AttributeKey[]; weights?: number[]; rounding?: 'nearest' }[] = [
  { name: 'Athleticism', keys: ['acceleration', 'sprintSpeed', 'agility', 'balance', 'jumping', 'stamina', 'strength', 'reactions'] },
  { name: 'Technical ability', keys: ['ballControl', 'dribbling', 'headingAccuracy', 'curve', 'freeKickAccuracy'] },
  { name: 'Shooting', keys: ['finishing', 'volleys', 'penalties', 'shotPower', 'longShots'] },
  // FIFA's scout card gives crossing and short passing more influence than
  // long passing and vision (rather than averaging only three passing fields).
  { name: 'Passing', keys: ['crossing', 'shortPassing', 'longPassing', 'vision'], weights: [30, 35, 20, 15] },
  { name: 'Defending', keys: ['marking', 'standingTackle', 'slidingTackle'] },
  { name: 'Mentality', keys: ['aggression', 'interceptions', 'attackingPosition', 'vision', 'composure'] },
]

export function averageRating(player: Player, keys: AttributeKey[], rounding?: 'nearest', weights?: number[]): RatingRange | null {
  const values = keys.map((key, index) => ({ value: player.attributes[key], weight: weights?.[index] ?? 1 })).filter((entry): entry is { value: RatingRange; weight: number } => entry.value !== null)
  const finish = rounding === 'nearest' ? Math.round : Math.floor
  const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0)
  return values.length ? {
    min: finish(values.reduce((sum, entry) => sum + entry.value.min * entry.weight, 0) / totalWeight),
    max: finish(values.reduce((sum, entry) => sum + entry.value.max * entry.weight, 0) / totalWeight),
  } : null
}
