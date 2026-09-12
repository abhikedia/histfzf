import { test, expect } from 'vitest'
import * as c from './constants'

test('constants match the specification tables', () => {
  expect(c.DB_NAME).toBe('histfzf')
  expect(c.DB_VERSION).toBe(1)
  expect(c.STORE_PAGES).toBe('pages')
  expect(c.IDX_LAST_VISIT).toBe('by_lastVisit')
  expect(c.IDX_HOST).toBe('by_host')

  expect(c.SEED_WINDOW_DAYS).toBe(7)
  expect(c.SEED_MAX_RESULTS).toBe(10000)
  expect(c.SEED_WM_KEY).toBe('seedWatermark')
  expect(c.SEED_DONE_KEY).toBe('seedComplete')
  expect(c.SEED_MAX_WINDOWS).toBe(520)
  expect(c.SEED_EMPTY_STREAK_CAP).toBe(2)

  expect(c.W_FRECENCY_FREQ).toBe(1.0)
  expect(c.W_FRECENCY_REC).toBe(1.0)
  expect(c.RECENCY_HALFLIFE_DAYS).toBe(14)
  expect(c.FRECENCY_CAP).toBe(1.0)
  expect(c.TYPED_WEIGHT).toBe(2)

  expect(c.RENDER_CAP).toBe(50)
  expect(c.FZF_POOL_SIZE).toBe(500)
  expect(c.LANDING_SIZE).toBe(10)
  expect(c.OMNIBOX_COUNT).toBe(6)

  expect(c.DAY_MS).toBe(86_400_000)

  expect(c.IFRAME_ID).toBe('histfzf-overlay-frame')

  expect(c.MSG.GET_INDEX).toBe('GET_INDEX')
  expect(c.MSG.OPEN_NEW_TAB).toBe('OPEN_NEW_TAB')
  expect(c.MSG.RESTORE_TAB).toBe('RESTORE_TAB')
  expect(c.MSG.NAVIGATE).toBe('NAVIGATE')
  expect(c.MSG.CLOSE).toBe('CLOSE')
  expect(c.MSG.SHOW).toBe('SHOW')
})

test('FZF pool stays larger than the render cap', () => {
  expect(c.FZF_POOL_SIZE).toBeGreaterThan(c.RENDER_CAP)
})
