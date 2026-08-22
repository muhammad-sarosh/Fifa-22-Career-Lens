import Papa from 'papaparse'
import { emptyAttributes } from './scoring'
import { attributeKeys, type AttributeKey, type CurrencyCode, type ImportResult, type KnowledgeLevel, type Player, type PlayerScope, type RatingRange } from './types'

const aliases: Record<AttributeKey, string[]> = {
  ballControl: ['ballcontrol'], dribbling: ['dribbling'], crossing: ['crossing'], shortPassing: ['shortpassing', 'shortpass'], longPassing: ['longpassing', 'longpass'],
  finishing: ['finishing'], headingAccuracy: ['headingaccuracy'], volleys: ['volleys'], curve: ['curve'], freeKickAccuracy: ['freekickaccuracy'], penalties: ['penalties'],
  acceleration: ['acceleration'], sprintSpeed: ['sprintspeed'], agility: ['agility'], balance: ['balance'], reactions: ['reactions'],
  shotPower: ['shotpower'], jumping: ['jumping'], stamina: ['stamina'], strength: ['strength'], longShots: ['longshots'],
  aggression: ['aggression'], interceptions: ['interceptions'], attackingPosition: ['attackingposition', 'positioning'], vision: ['vision'], composure: ['composure'],
  marking: ['marking', 'defensiveawareness'], standingTackle: ['standingtackle', 'standtackle'], slidingTackle: ['slidingtackle'],
  gkDiving: ['gkdiving'], gkHandling: ['gkhandling'], gkKicking: ['gkkicking'], gkPositioning: ['gkpositioning'], gkReflexes: ['gkreflexes'],
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const clamp = (value: number) => Math.max(1, Math.min(99, value))

function numericToken(value: unknown, money = false): number | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text === 'unknown' || text === '—' || text === '-') return null
  const multiplier = money && text.endsWith('m') ? 1_000_000 : money && text.endsWith('k') ? 1_000 : 1
  const parsed = Number(text.replace(/[$,€£mk\s]/g, ''))
  return Number.isFinite(parsed) ? parsed * multiplier : null
}

function parseRange(value: unknown, money = false): RatingRange | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parts = text.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean)
  const first = numericToken(parts[0], money)
  const second = numericToken(parts[1], money)
  if (first === null) return null
  const min = money ? first : clamp(first)
  const max = money ? (second ?? first) : clamp(second ?? first)
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

function readRange(row: Record<string, string>, names: string[], money = false): RatingRange | null {
  for (const name of names) {
    const key = normalize(name)
    const direct = parseRange(row[key], money)
    if (direct) return direct
    const min = numericToken(row[`${key}min`], money)
    const max = numericToken(row[`${key}max`], money)
    if (min !== null || max !== null) {
      const low = min ?? max!
      const high = max ?? min!
      return money ? { min: Math.min(low, high), max: Math.max(low, high) } : { min: clamp(Math.min(low, high)), max: clamp(Math.max(low, high)) }
    }
  }
  return null
}

const scopeValue = (value: string): PlayerScope => {
  const scope = value.toLowerCase()
  if (scope.includes('youth') || scope.includes('academy')) return 'Youth academy'
  if (scope.includes('squad')) return 'My squad'
  if (scope.includes('scout')) return 'Scouting'
  if (scope.includes('short')) return 'Shortlist'
  if (scope.includes('search')) return 'Player search'
  return 'Other'
}

const booleanValue = (value: string, fallback: boolean) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return ['1', 'true', 'yes', 'y'].includes(normalized)
}

const currencyCode = (value: string): CurrencyCode => {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized === 'EUR' ? 'EUR' : normalized === 'GBP' ? 'GBP' : 'USD'
}

export function parsePlayerCsv(csv: string): ImportResult {
  const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: normalize })
  const players: Player[] = []
  let rejectedRows = result.errors.length

  result.data.forEach((row, index) => {
    const name = row.name || row.playername || row.longname
    if (!name) { rejectedRows += 1; return }
    const attributes = emptyAttributes()
    for (const key of attributeKeys) attributes[key] = readRange(row, aliases[key])
    const known = Object.values(attributes).filter(Boolean) as RatingRange[]
    const hasRanges = known.some((value) => value.min !== value.max)
    const knowledgeText = String(row.knowledge || row.visibility || '').toLowerCase()
    const knowledge: KnowledgeLevel = knowledgeText.includes('unknown') || known.length === 0 ? 'Unknown' : knowledgeText.includes('range') || hasRanges ? 'Ranged' : 'Exact'
    const footText = String(row.preferredfoot || row.foot || '').toLowerCase()
    const preferredFoot: Player['preferredFoot'] = footText === 'left' ? 'Left' : footText === 'right' ? 'Right' : 'Unknown'
    const scope = scopeValue(row.scope || row.source || '')
    players.push({
      id: row.playerid || row.id || `import-${index}-${normalize(name)}`,
      name,
      club: row.club || row.teamname || row.team || 'Unknown club',
      age: numericToken(row.age),
      positions: String(row.positions || row.position || 'N/A').split(/[,/]/).map((position) => position.trim()).filter(Boolean),
      preferredFoot,
      overall: readRange(row, ['overall', 'ovr']),
      potential: readRange(row, ['potential', 'pot']),
      value: readRange(row, ['value'], true),
      wage: readRange(row, ['wage'], true),
      currency: currencyCode(row.currency),
      scope,
      shortlisted: booleanValue(row.shortlisted, scope === 'Shortlist'),
      scouting: booleanValue(row.scouting, scope === 'Scouting'),
      knowledge,
      attributes,
    })
  })
  return { players, rejectedRows }
}
