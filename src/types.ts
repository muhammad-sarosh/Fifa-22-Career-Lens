export const attributeKeys = [
  'ballControl', 'dribbling', 'crossing', 'shortPassing', 'longPassing',
  'finishing', 'headingAccuracy', 'volleys', 'curve', 'freeKickAccuracy', 'penalties',
  'acceleration', 'sprintSpeed', 'agility', 'balance', 'reactions',
  'shotPower', 'jumping', 'stamina', 'strength', 'longShots',
  'aggression', 'interceptions', 'attackingPosition', 'vision', 'composure',
  'marking', 'standingTackle', 'slidingTackle',
  'gkDiving', 'gkHandling', 'gkKicking', 'gkPositioning', 'gkReflexes',
] as const

export type AttributeKey = (typeof attributeKeys)[number]
export type RatingRange = { min: number; max: number }
export type PlayerScope = 'My squad' | 'Scouting' | 'Shortlist' | 'Player search' | 'Other'
export type KnowledgeLevel = 'Exact' | 'Ranged' | 'Unknown'

export type Player = {
  id: string
  name: string
  club: string
  age: number | null
  positions: string[]
  preferredFoot: 'Left' | 'Right' | 'Unknown'
  overall: RatingRange | null
  value: RatingRange | null
  wage: RatingRange | null
  scope: PlayerScope
  knowledge: KnowledgeLevel
  attributes: Record<AttributeKey, RatingRange | null>
}

export type PresetId = 'GK' | 'CB' | 'FB' | 'CDM' | 'CM' | 'CAM' | 'WINGER' | 'ST'
export type PositionPreset = { id: string; name: string; position?: PresetId; description?: string; weights: Partial<Record<AttributeKey, number>> }

export type CareerSave = {
  name: string
  displayName: string
  path: string
  size: number
  modifiedUnixMs: number
  isAutosave: boolean
}

export type ImportResult = { players: Player[]; rejectedRows: number }
