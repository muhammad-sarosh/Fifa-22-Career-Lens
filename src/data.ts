import { emptyAttributes } from './scoring'
import type { AttributeKey, Player, RatingRange } from './types'

const exact = (value: number): RatingRange => ({ min: value, max: value })
const ranged = (min: number, max: number): RatingRange => ({ min, max })
const attributes = (values: Partial<Record<AttributeKey, RatingRange>>): Player['attributes'] => ({ ...emptyAttributes(), ...values })

// Fixtures are used by tests only. The production application starts empty.
export const fixturePlayers: Player[] = [
  { id: 'fixture-1', name: 'Fully Known Player', club: 'Test FC', age: 24, positions: ['LW', 'ST'], preferredFoot: 'Right', overall: exact(74), value: exact(6_000_000), wage: exact(18_000), scope: 'My squad', knowledge: 'Exact', attributes: attributes({ acceleration: exact(91), sprintSpeed: exact(87), agility: exact(89), stamina: exact(79), dribbling: exact(74), ballControl: exact(72), shortPassing: exact(66), vision: exact(67), crossing: exact(61), finishing: exact(75), attackingPosition: exact(77), composure: exact(69) }) },
  { id: 'fixture-2', name: 'Partially Scouted Player', club: 'Range FC', age: 21, positions: ['LM', 'LW'], preferredFoot: 'Right', overall: ranged(71, 75), value: ranged(8_000_000, 11_000_000), wage: null, scope: 'Scouting', knowledge: 'Ranged', attributes: attributes({ acceleration: ranged(80, 86), sprintSpeed: ranged(82, 88), agility: ranged(70, 76), stamina: ranged(68, 74), dribbling: ranged(76, 82), ballControl: ranged(74, 80), shortPassing: ranged(67, 73), vision: ranged(66, 72), crossing: ranged(73, 79), finishing: ranged(63, 69), attackingPosition: ranged(69, 75), composure: ranged(69, 75) }) },
]
