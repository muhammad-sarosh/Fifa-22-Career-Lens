import { invoke } from '@tauri-apps/api/core'
import type { CareerSave } from './types'

export async function listCareerSaves(): Promise<CareerSave[]> {
  if (!('__TAURI_INTERNALS__' in window)) return []
  return invoke<CareerSave[]>('list_career_saves')
}

export async function readCareerSave(path: string): Promise<string> {
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('Offline save loading is available in the desktop app.')
  return invoke<string>('read_career_save', { path })
}

export type PickedCareer = { save: CareerSave; csv: string }

export async function pickCareerSave(): Promise<PickedCareer | null> {
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('Career-save selection is available in the desktop app.')
  return invoke<PickedCareer | null>('pick_career_save')
}
