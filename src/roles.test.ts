import { describe, expect, it } from 'vitest'
import { allRolePresets, rolePresets } from './roles'

describe('role-specific presets', () => {
  it('includes every role from the supplied tables', () => {
    expect(allRolePresets).toHaveLength(32)
    expect(rolePresets.ST.find((role) => role.id === 'ST_TARGET')?.weights.headingAccuracy).toBe(10)
    expect(rolePresets.WINGER.find((role) => role.id === 'WG_EXPLOSIVE')?.weights.acceleration).toBe(10)
    expect(rolePresets.CAM.find((role) => role.id === 'CAM_PLAYMAKER')?.weights.vision).toBe(10)
  })
})
