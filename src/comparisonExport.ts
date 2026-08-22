import { attributeKeys, type AttributeKey, type Player, type PositionPreset, type PresetId } from './types'
import { attributeLabels, defaultPresets, formatMoney, formatRating, midpoint, scoreForPreset } from './scoring'

export type ComparisonExportView = 'matrix' | 'profiles' | 'ranking'
export type ComparisonExportMode = 'ALL' | PresetId

function cell(value: string | number | null | undefined) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function table(headers: string[], rows: (string | number | null | undefined)[][]) {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n')
}

export function buildComparisonMarkdown({ players, preset, mode, view }: {
  players: Player[]
  preset: PositionPreset
  mode: ComparisonExportMode
  view: ComparisonExportView
}) {
  const category = mode === 'ALL' ? 'All attributes' : defaultPresets[mode].name
  const lines = ['# Career Lens player comparison', '', `- Category: ${category}`]
  if (mode !== 'ALL') {
    lines.push(`- Player type: ${preset.name}`)
    if (preset.description) lines.push(`- Description: ${preset.description}`)
  }
  lines.push(`- Players: ${players.length}`, '')

  if (view === 'ranking' && mode !== 'ALL') {
    const ranked = [...players].sort((left, right) => (midpoint(scoreForPreset(right, preset).score) ?? -1) - (midpoint(scoreForPreset(left, preset).score) ?? -1))
    lines.push(table(['Rank', 'Player', 'Club', 'Position', 'Score', 'OVR', 'Age', 'Value', 'Wage'], ranked.map((player, index) => [
      index + 1, player.name, player.club, player.positions.join(' / '), formatRating(scoreForPreset(player, preset).score), formatRating(player.overall), player.age, formatMoney(player.value, player.currency), formatMoney(player.wage, player.currency),
    ])))
    return lines.join('\n')
  }

  const keys: AttributeKey[] = mode === 'ALL'
    ? [...attributeKeys]
    : (Object.entries(preset.weights) as [AttributeKey, number][]).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).map(([key]) => key)
  const rows: (string | number | null | undefined)[][] = []
  if (mode !== 'ALL') rows.push(['Score', ...players.map((player) => formatRating(scoreForPreset(player, preset).score))])
  rows.push(['Overall', ...players.map((player) => formatRating(player.overall))])
  rows.push(['Age', ...players.map((player) => player.age)])
  rows.push(['Value', ...players.map((player) => formatMoney(player.value, player.currency))])
  for (const key of keys) rows.push([attributeLabels[key], ...players.map((player) => formatRating(player.attributes[key]))])
  lines.push(table(['Attribute', ...players.map((player) => player.name)], rows))
  return lines.join('\n')
}
