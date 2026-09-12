import {
  FRECENCY_CAP,
  RECENCY_HALFLIFE_DAYS,
  W_FRECENCY_FREQ,
  W_FRECENCY_REC,
} from './constants'

/**
 * Tunable ranking weights, edited in the options page, persisted in
 * chrome.storage.local. Every consumer (palette + omnibox) reads this
 * same key; defaults come straight from the token constants so an
 * options reset == factory behavior.
 */

export interface HistFzfSettings {
  wf: number
  wr: number
  halflifeDays: number
  cap: number
}

export const DEFAULT_SETTINGS: HistFzfSettings = {
  wf: W_FRECENCY_FREQ,
  wr: W_FRECENCY_REC,
  halflifeDays: RECENCY_HALFLIFE_DAYS,
  cap: FRECENCY_CAP,
}

export interface SettingRange {
  min: number
  max: number
  step: number
}

export const SETTINGS_RANGES: Record<keyof HistFzfSettings, SettingRange> = {
  wf: { min: 0, max: 3, step: 0.1 },
  wr: { min: 0, max: 3, step: 0.1 },
  halflifeDays: { min: 1, max: 60, step: 1 },
  cap: { min: 0, max: 2, step: 0.05 },
}

export const SETTINGS_KEY = 'settings'

function snap(value: number, range: SettingRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value))
  // Kill float dust (0.1 steps land on 0.35000000000000003 otherwise).
  return Math.round(Math.round(clamped / range.step) * range.step * 1e6) / 1e6
}

/** Everything the storage might hold collapses into a valid HistFzfSettings:
 * malformed JSON shapes fall back to defaults field-by-field; numbers are
 * clamped + snapped to their range (a slider never produces an invalid
 * state, and hand-edited storage self-heals). */
export function sanitizeSettings(raw: unknown): HistFzfSettings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_SETTINGS }
  }
  const record = raw as Record<string, unknown>
  const pick = (key: keyof HistFzfSettings): number => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value)
      ? snap(value, SETTINGS_RANGES[key])
      : DEFAULT_SETTINGS[key]
  }
  return {
    wf: pick('wf'),
    wr: pick('wr'),
    halflifeDays: pick('halflifeDays'),
    cap: pick('cap'),
  }
}

export async function readSettings(): Promise<HistFzfSettings> {
  try {
    const stored = await chrome.storage.local.get([SETTINGS_KEY])
    return sanitizeSettings(stored[SETTINGS_KEY])
  } catch {
    // Node tests / storage failure → factory weights.
    return { ...DEFAULT_SETTINGS }
  }
}

export async function writeSettings(settings: HistFzfSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}
