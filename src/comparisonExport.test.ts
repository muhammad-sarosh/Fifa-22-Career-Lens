import { describe, expect, it } from 'vitest'
import { buildComparisonMarkdown } from './comparisonExport'
import { defaultPresets, emptyAttributes } from './scoring'
import type { Player } from './types'

const player: Player = {
  id: '1', name: 'Alex | Example', club: 'Test FC', age: 21, positions: ['ST'], preferredFoot: 'Right', scope: 'My squad', shortlisted: false, scouting: false, knowledge: 'Exact',
  overall: { min: 75, max: 75 }, potential: null, value: { min: 5_000_000, max: 5_000_000 }, wage: { min: 25_000, max: 25_000 },
  attributes: { ...emptyAttributes(), finishing: { min: 80, max: 80 } },
}

describe('comparison Markdown export', () => {
  it('includes category and player type metadata in matrix exports', () => {
    const markdown = buildComparisonMarkdown({ players: [player], preset: defaultPresets.ST, mode: 'ST', view: 'matrix' })
    expect(markdown).toContain('- Category: Striker')
    expect(markdown).toContain('- Player type: Striker')
    expect(markdown).toContain('| Overall | 75 |')
    expect(markdown).toContain('Alex \\| Example')
  })

  it('includes OVR in ranking exports', () => {
    const markdown = buildComparisonMarkdown({ players: [player], preset: defaultPresets.ST, mode: 'ST', view: 'ranking' })
    expect(markdown).toContain('| Rank | Player | Club | Position | Score | OVR | Age | Value | Wage |')
    expect(markdown).toContain('| 1 | Alex \\| Example | Test FC | ST | 80 | 75 | 21 | $5m | $25k |')
  })
})
