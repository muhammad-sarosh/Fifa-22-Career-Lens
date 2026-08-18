import { attributeKeys, type AttributeKey, type Player, type PositionPreset, type PresetId, type RatingRange } from './types'

export const attributeGroups: { name: string; keys: AttributeKey[] }[] = [
  { name: 'Technical', keys: ['ballControl', 'dribbling', 'crossing', 'shortPassing', 'longPassing', 'finishing', 'headingAccuracy', 'volleys', 'curve', 'freeKickAccuracy', 'penalties'] },
  { name: 'Movement', keys: ['acceleration', 'sprintSpeed', 'agility', 'balance', 'reactions'] },
  { name: 'Power', keys: ['shotPower', 'jumping', 'stamina', 'strength', 'longShots'] },
  { name: 'Mental', keys: ['aggression', 'interceptions', 'attackingPosition', 'vision', 'composure'] },
  { name: 'Defending', keys: ['marking', 'standingTackle', 'slidingTackle'] },
  { name: 'Goalkeeping', keys: ['gkDiving', 'gkHandling', 'gkKicking', 'gkPositioning', 'gkReflexes'] },
]

export const attributeLabels: Record<AttributeKey, string> = {
  ballControl: 'Ball control', dribbling: 'Dribbling', crossing: 'Crossing', shortPassing: 'Short passing', longPassing: 'Long passing',
  finishing: 'Finishing', headingAccuracy: 'Heading accuracy', volleys: 'Volleys', curve: 'Curve', freeKickAccuracy: 'Free-kick accuracy', penalties: 'Penalties',
  acceleration: 'Acceleration', sprintSpeed: 'Sprint speed', agility: 'Agility', balance: 'Balance', reactions: 'Reactions',
  shotPower: 'Shot power', jumping: 'Jumping', stamina: 'Stamina', strength: 'Strength', longShots: 'Long shots',
  aggression: 'Aggression', interceptions: 'Interceptions', attackingPosition: 'Attacking position', vision: 'Vision', composure: 'Composure',
  marking: 'Defensive awareness', standingTackle: 'Standing tackle', slidingTackle: 'Sliding tackle',
  gkDiving: 'GK diving', gkHandling: 'GK handling', gkKicking: 'GK kicking', gkPositioning: 'GK positioning', gkReflexes: 'GK reflexes',
}

export const defaultPresets: Record<PresetId, PositionPreset> = {
  GK: { id: 'GK', name: 'Goalkeeper', weights: { ballControl: 1, dribbling: 0, crossing: 0, shortPassing: 3, longPassing: 4, finishing: 0, headingAccuracy: 0, volleys: 0, curve: 0, freeKickAccuracy: 0, penalties: 0, acceleration: 1, sprintSpeed: 1, agility: 2, balance: 2, reactions: 9, shotPower: 0, jumping: 5, stamina: 2, strength: 3, longShots: 0, aggression: 1, interceptions: 0, attackingPosition: 0, vision: 1, composure: 8, marking: 0, standingTackle: 0, slidingTackle: 0, gkDiving: 10, gkHandling: 9, gkKicking: 7, gkPositioning: 10, gkReflexes: 10 } },
  CB: { id: 'CB', name: 'Centre back', weights: { ballControl: 4, dribbling: 2, crossing: 1, shortPassing: 6, longPassing: 6, finishing: 0, headingAccuracy: 8, volleys: 0, curve: 0, freeKickAccuracy: 0, penalties: 0, acceleration: 6, sprintSpeed: 7, agility: 3, balance: 5, reactions: 9, shotPower: 1, jumping: 9, stamina: 7, strength: 10, longShots: 1, aggression: 8, interceptions: 10, attackingPosition: 1, vision: 3, composure: 9, marking: 10, standingTackle: 10, slidingTackle: 9, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
  FB: { id: 'FB', name: 'Fullback / wingback', weights: { ballControl: 7, dribbling: 7, crossing: 9, shortPassing: 7, longPassing: 6, finishing: 2, headingAccuracy: 3, volleys: 1, curve: 5, freeKickAccuracy: 1, penalties: 0, acceleration: 9, sprintSpeed: 9, agility: 8, balance: 7, reactions: 8, shotPower: 3, jumping: 6, stamina: 10, strength: 7, longShots: 2, aggression: 7, interceptions: 8, attackingPosition: 5, vision: 6, composure: 7, marking: 9, standingTackle: 9, slidingTackle: 8, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
  CDM: { id: 'CDM', name: 'Defensive midfielder', weights: { ballControl: 7, dribbling: 5, crossing: 2, shortPassing: 9, longPassing: 9, finishing: 2, headingAccuracy: 5, volleys: 1, curve: 3, freeKickAccuracy: 1, penalties: 0, acceleration: 6, sprintSpeed: 6, agility: 5, balance: 7, reactions: 9, shotPower: 4, jumping: 7, stamina: 9, strength: 9, longShots: 4, aggression: 9, interceptions: 10, attackingPosition: 3, vision: 8, composure: 9, marking: 10, standingTackle: 10, slidingTackle: 8, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
  CM: { id: 'CM', name: 'Central midfielder', weights: { ballControl: 9, dribbling: 8, crossing: 5, shortPassing: 10, longPassing: 9, finishing: 5, headingAccuracy: 3, volleys: 3, curve: 6, freeKickAccuracy: 3, penalties: 1, acceleration: 7, sprintSpeed: 6, agility: 8, balance: 8, reactions: 9, shotPower: 6, jumping: 5, stamina: 10, strength: 7, longShots: 7, aggression: 7, interceptions: 7, attackingPosition: 7, vision: 10, composure: 9, marking: 7, standingTackle: 7, slidingTackle: 5, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
  CAM: { id: 'CAM', name: 'Attacking midfielder', weights: { ballControl: 10, dribbling: 10, crossing: 6, shortPassing: 10, longPassing: 7, finishing: 8, headingAccuracy: 2, volleys: 6, curve: 8, freeKickAccuracy: 5, penalties: 2, acceleration: 8, sprintSpeed: 7, agility: 10, balance: 9, reactions: 9, shotPower: 8, jumping: 3, stamina: 8, strength: 5, longShots: 9, aggression: 4, interceptions: 3, attackingPosition: 10, vision: 10, composure: 10, marking: 2, standingTackle: 2, slidingTackle: 1, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
  WINGER: { id: 'WINGER', name: 'Winger', weights: { ballControl: 9, dribbling: 10, crossing: 9, shortPassing: 8, longPassing: 4, finishing: 8, headingAccuracy: 2, volleys: 6, curve: 8, freeKickAccuracy: 4, penalties: 2, acceleration: 10, sprintSpeed: 10, agility: 10, balance: 9, reactions: 8, shotPower: 7, jumping: 3, stamina: 9, strength: 5, longShots: 8, aggression: 4, interceptions: 2, attackingPosition: 9, vision: 8, composure: 8, marking: 2, standingTackle: 2, slidingTackle: 1, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
  ST: { id: 'ST', name: 'Striker', weights: { ballControl: 8, dribbling: 8, crossing: 2, shortPassing: 7, longPassing: 2, finishing: 10, headingAccuracy: 8, volleys: 8, curve: 7, freeKickAccuracy: 3, penalties: 3, acceleration: 9, sprintSpeed: 9, agility: 8, balance: 7, reactions: 9, shotPower: 9, jumping: 8, stamina: 8, strength: 8, longShots: 8, aggression: 6, interceptions: 2, attackingPosition: 10, vision: 6, composure: 10, marking: 1, standingTackle: 1, slidingTackle: 0, gkDiving: 0, gkHandling: 0, gkKicking: 0, gkPositioning: 0, gkReflexes: 0 } },
}

export const midpoint = (range: RatingRange | null) => range ? (range.min + range.max) / 2 : null
export const formatRating = (range: RatingRange | null) => !range ? '—' : range.min === range.max ? String(range.min) : `${range.min} – ${range.max}`
export const formatMoney = (range: RatingRange | null) => {
  if (!range) return '—'
  const compact = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m` : `$${Math.round(value / 1000)}k`
  return range.min === range.max ? compact(range.min) : `${compact(range.min)} – ${compact(range.max)}`
}

export function scoreForPreset(player: Player, preset: PositionPreset) {
  const entries = Object.entries(preset.weights) as [AttributeKey, number][]
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let knownWeight = 0, weightedMin = 0, weightedMax = 0
  const breakdown = entries.map(([key, weight]) => {
    const value = player.attributes[key]
    if (value) { knownWeight += weight; weightedMin += value.min * weight; weightedMax += value.max * weight }
    return { key, weight, value }
  }).sort((a, b) => b.weight - a.weight)
  const coverage = totalWeight ? Math.round((knownWeight / totalWeight) * 100) : 0
  const score = knownWeight ? { min: Math.round(weightedMin / knownWeight), max: Math.round(weightedMax / knownWeight) } : null
  return { score, coverage, breakdown }
}

export function emptyAttributes(): Player['attributes'] {
  return Object.fromEntries(attributeKeys.map((key) => [key, null])) as Player['attributes']
}
