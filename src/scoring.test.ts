import { describe, expect, it } from 'vitest'
import { fifaRatingBand, formatMoney } from './scoring'

describe('currency-aware money formatting', () => {
  it('uses the symbol selected in the career save', () => {
    const value = { min: 4_400_000, max: 4_400_000 }
    expect(formatMoney(value, 'USD')).toBe('$4.4m')
    expect(formatMoney(value, 'EUR')).toBe('€4.4m')
    expect(formatMoney(value, 'GBP')).toBe('£4.4m')
  })
})

describe('FIFA rating color bands', () => {
  it('changes color immediately after 50, 60, 70 and 80', () => {
    expect([50, 51, 60, 61, 70, 71, 80, 81].map(fifaRatingBand)).toEqual([
      'red', 'orange', 'orange', 'yellow', 'yellow', 'green', 'green', 'elite',
    ])
  })
})
