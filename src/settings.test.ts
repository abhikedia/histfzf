import { test, expect } from 'vitest'
import { installChromeMock } from './test-harness'
import {
  DEFAULT_SETTINGS,
  SETTINGS_RANGES,
  readSettings,
  writeSettings,
  sanitizeSettings,
} from './settings'

test('anything not an object collapses to the factory defaults', () => {
  for (const garbage of [undefined, null, 42, 'x', [], {}]) {
    expect(sanitizeSettings(garbage)).toEqual(DEFAULT_SETTINGS)
  }
})

test('valid values pass through untouched', () => {
  expect(
    sanitizeSettings({ wf: 1.5, wr: 0.5, halflifeDays: 30, cap: 1 }),
  ).toEqual({ wf: 1.5, wr: 0.5, halflifeDays: 30, cap: 1 })
})

test('out-of-range numbers clamp to their range', () => {
  const sanitized = sanitizeSettings({
    wf: 10,
    wr: -2,
    halflifeDays: 400,
    cap: 9,
  })
  expect(sanitized.wf).toBe(SETTINGS_RANGES.wf.max)
  expect(sanitized.wr).toBe(SETTINGS_RANGES.wr.min)
  expect(sanitized.halflifeDays).toBe(SETTINGS_RANGES.halflifeDays.max)
  expect(sanitized.cap).toBe(SETTINGS_RANGES.cap.max)
})

test('values snap to their step (a slider can never emit an invalid state)', () => {
  expect(sanitizeSettings({ wf: 1.234 }).wf).toBeCloseTo(1.2, 5)
  expect(sanitizeSettings({ halflifeDays: 13.7 }).halflifeDays).toBe(14)
  expect(sanitizeSettings({ cap: 0.333 }).cap).toBeCloseTo(0.35, 5)
})

test('missing fields fall back field-by-field (partial storage self-heals)', () => {
  const sanitized = sanitizeSettings({ wf: 2 })
  expect(sanitized).toEqual({
    wf: 2,
    wr: DEFAULT_SETTINGS.wr,
    halflifeDays: DEFAULT_SETTINGS.halflifeDays,
    cap: DEFAULT_SETTINGS.cap,
  })
})

test('non-number, non-finite fields fall back field-by-field', () => {
  expect(sanitizeSettings({ wf: 'heavy', wr: Number.NaN })).toEqual(DEFAULT_SETTINGS)
})

test('settings round-trip through the chrome storage bridge', async () => {
  installChromeMock()
  await writeSettings({ ...DEFAULT_SETTINGS, wf: 1.5, cap: 0.8 })
  const read = await readSettings()
  expect(read.wf).toBe(1.5)
  expect(read.cap).toBe(0.8)
  expect(read.wr).toBe(DEFAULT_SETTINGS.wr)
  // Self-healing storage too: a garbage blob sanitizes on read.
  await chrome.storage.local.set({
    settings: { wf: 'not a number', halflifeDays: 999 },
  })
  const healed = await readSettings()
  expect(healed.wf).toBe(DEFAULT_SETTINGS.wf)
  expect(healed.halflifeDays).toBe(SETTINGS_RANGES.halflifeDays.max)
}, 10_000)
