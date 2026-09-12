import {
  DAY_MS,
  SEED_DONE_KEY,
  SEED_EMPTY_STREAK_CAP,
  SEED_MAX_WINDOWS,
  SEED_WINDOW_DAYS,
  SEED_WM_KEY,
} from './constants'
import * as db from './db'
import type { HistoryItemRaw } from './db'

/**
 * Seeding — the SW imports existing chrome.history into our own
 * IndexedDB index.
 *
 * chrome.history.search has no cursor/pagination, so the walk goes
 * BACKWARDS in fixed-time windows. Resumability contract: before
 * advancing to the next window the seed persists that window's
 * startTime as the watermark — "everything newer than the watermark
 * is imported". If the process dies mid-walk, the next wake re-runs
 * the walk from the watermark; redoing a partially imported window is
 * harmless because seed merges are idempotent (max/min).
 *
 * A zero-item window is NOT proof of end-of-history (a quiet vacation
 * week would trip it); SEED_EMPTY_STREAK_CAP consecutive empty windows
 * is the conservative stop signal. SEED_MAX_WINDOWS is the runaway cap.
 */

export interface SeedState {
  done?: boolean
  watermark?: number
}

export interface SeedDeps {
  readState(): Promise<SeedState>
  writeState(patch: Record<string, unknown>): Promise<void>
  clearWatermark(): Promise<void>
  searchHistory(range: { startTime: number; endTime: number }): Promise<HistoryItemRaw[]>
  now(): number
}

// In-flight mutex. Module-scope is fine: it holds no index data, and a
// death loses only the mutex — doubly-processed windows are idempotent.
let running = false

/** Test seam: clears the in-flight mutex between suites. */
export function resetSeedRunnerForTests(): void {
  running = false
}

export async function runSeed(deps: SeedDeps): Promise<void> {
  if (running) {
    return
  }
  running = true
  try {
    const stored = await deps.readState()
    if (stored.done) {
      return
    }
    // Missing watermark = fresh walk: start "now". Present watermark =
    // resume: the window whose range starts at the watermark is redone.
    let endTime: number = stored.watermark ?? deps.now()
    let emptyStreak = 0

    for (let windowIndex = 0; windowIndex < SEED_MAX_WINDOWS; windowIndex++) {
      const startTime = endTime - SEED_WINDOW_DAYS * DAY_MS
      const items = await deps.searchHistory({ startTime, endTime })

      if (items.length === 0) {
        emptyStreak += 1
      } else {
        emptyStreak = 0
        for (const item of items) {
          await db.importHistoryItem(item)
        }
      }

      // Watermark = this window's start ("everything newer is imported"),
      // persisted BEFORE advancing to the next window.
      await deps.writeState({ [SEED_WM_KEY]: startTime })

      if (emptyStreak >= SEED_EMPTY_STREAK_CAP) {
        await deps.writeState({ [SEED_DONE_KEY]: true })
        await deps.clearWatermark()
        return
      }
      endTime = startTime
    }

    // Runaway guard reached: mark done instead of looping forever.
    await deps.writeState({ [SEED_DONE_KEY]: true })
    await deps.clearWatermark()
  } finally {
    running = false
  }
}

export function isSeedRunning(): boolean {
  return running
}
