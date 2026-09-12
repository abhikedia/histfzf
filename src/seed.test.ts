import { test, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  runSeed,
  resetSeedRunnerForTests,
  isSeedRunningForTests,
  type SeedDeps,
} from './seed'
import {
  SEED_DONE_KEY,
  SEED_MAX_WINDOWS,
  SEED_WM_KEY,
} from './constants'
import { resetForTests } from './db'
import * as db from './db'
import type { HistoryItemRaw } from './db'

const NOW = 1_700_000_000_000
const DAY = 86_400_000
const WEEK = 7 * DAY

type Call = { startTime: number; endTime: number }

/** Scripted searchHistory: each call consumes the next entry; an entry
 * of { error } throws (simulates dying mid-walk), { gate } blocks. */
function makeDeps(opts: {
  state?: { done?: boolean; watermark?: number }
  steps?: Array<{
    items?: HistoryItemRaw[]
    error?: unknown
    gate?: Promise<void>
  }>
  writes?: Map<string, unknown>
}) {
  const state: { done?: boolean; watermark?: number } = { ...opts.state }
  const writes = opts.writes ?? new Map<string, unknown>()
  const calls: Call[] = []

  const deps: SeedDeps & {
    calls: Call[]
    state: typeof state
    writes: Map<string, unknown>
  } = {
    calls,
    state,
    writes,
    async readState() {
      return { ...state }
    },
    async writeState(patch) {
      // Translate the storage-keyed patch into the semantic SeedState
      // shape (mirrors what background.ts's readState does on the way
      // back out). Keys are referenced via the SAME constants the
      // production code writes through writeState — a rename breaks
      // this stub loudly rather than silently.
      if (patch[SEED_DONE_KEY] === true) {
        state.done = true
      }
      if (typeof patch[SEED_WM_KEY] === 'number') {
        state.watermark = patch[SEED_WM_KEY]
      }
      for (const [k, v] of Object.entries(patch)) {
        writes.set(k, v)
      }
    },
    async clearWatermark() {
      delete state.watermark
      writes.delete(SEED_WM_KEY)
    },
    async searchHistory(range) {
      calls.push({ ...range })
      const step = opts.steps?.[calls.length - 1]
      if (!step) {
        return []
      }
      if (step.gate) {
        await step.gate
      }
      if (step.error !== undefined) {
        throw step.error ?? new Error('scripted error')
      }
      return step.items ?? []
    },
    now() {
      return NOW
    },
  }
  return deps
}

beforeEach(async () => {
  resetSeedRunnerForTests()
  await resetForTests()
  const fakeGlobal = globalThis as unknown as { indexedDB?: IDBFactory }
  fakeGlobal.indexedDB = new IDBFactory()
})

test('fresh install: walks back one week per call, stops after the empty streak cap', async () => {
  const deps = makeDeps({
    steps: [
      { items: [{ url: 'https://example.com/a', visitCount: 3, lastVisitTime: NOW }] },
      { items: [] },
      { items: [] },
    ],
  })
  await runSeed(deps)

  // Window ranges: NOW backwards, one SEED_WINDOW_DAYS step per call.
  expect(deps.calls.map((c) => c.endTime)).toEqual([
    NOW,
    NOW - WEEK,
    NOW - 2 * WEEK,
  ])
  // The final watermark assignment is the last walked window's start.
  expect(deps.state.done).toBe(true)
  expect(deps.state.watermark).toBeUndefined()
})

test('watermark persists mid-walk: the window start where the walk died', async () => {
  // A death mid-walk (step 2 throws) leaves the watermark at window 1's
  // start — exactly what the resume path needs to redo that window.
  // This is the persisted-before-advancing ordering made observable.
  const deps = makeDeps({
    steps: [
      { items: [{ url: 'https://example.com/a', visitCount: 1, lastVisitTime: NOW }] },
      { error: new Error('sw died mid-walk') },
    ],
  })
  await runSeed(deps).catch(() => undefined)
  expect(deps.state.watermark).toBe(NOW - WEEK) // window 1's start
  // Same fact, observed through the write log — both views must agree.
  expect(deps.writes.get(SEED_WM_KEY)).toBe(NOW - WEEK)
})

test('resume: the walk continues from the stored watermark window', async () => {
  const deps = makeDeps({
    state: { watermark: NOW - 3 * WEEK },
    steps: [{ items: [] }, { items: [] }],
  })
  await runSeed(deps)
  // First call must redo/continue the window whose END is the watermark.
  expect(deps.calls[0]).toEqual({ endTime: NOW - 3 * WEEK, startTime: NOW - 4 * WEEK })
})

test('a mid-walk death seen across two runs never double-counts', async () => {
  // Run 1: window 1 imports aggregate(3 visits), window 2's search throws
  // (the SW died mid-walk before its watermark could move).
  const failing = makeDeps({
    steps: [
      { items: [{ url: 'https://example.com/a', visitCount: 3, lastVisitTime: NOW }] },
      { error: new Error('sw died') },
    ],
  })
  await runSeed(failing) // rejection path is expected; the watermark from window 1 is already persisted
    .catch(() => undefined)

  // Run 2: resumes from run 1's watermark (window 1's start) and re-delivers
  // the SAME aggregates — the merge must keep counts at 3, not 6.
  const second = makeDeps({
    state: { watermark: NOW - WEEK },
    steps: [
      { items: [{ url: 'https://example.com/a', visitCount: 3, lastVisitTime: NOW }] },
      { items: [] },
      { items: [] },
    ],
  })
  await runSeed(second)
  const rows = await db.getAll()
  expect(rows.map((r) => r.visitCount)).toEqual([3])
})

test('a quiet week does not end the walk: data resets the empty streak', async () => {
  const deps = makeDeps({
    steps: [
      { items: [] },
      { items: [{ url: 'https://example.com/a', visitCount: 1, lastVisitTime: NOW }] },
      { items: [] },
      { items: [] },
    ],
  })
  await runSeed(deps)
  expect(deps.state.done).toBe(true)
  // [empty][data][empty][empty] = 4 windows walked before stopping.
  expect(deps.calls).toHaveLength(4)
})

test('runaway cap: data every week still terminates at the window cap', async () => {
  const deps = makeDeps({
    steps: Array.from({ length: 520 + 2 }, () => ({
      items: [{ url: 'https://example.com/a', visitCount: 1, lastVisitTime: NOW }],
    })),
  })
  await runSeed(deps)
  expect(deps.state.done).toBe(true)
  // The boundary is pinned: exactly SEED_MAX_WINDOWS walked (an
  // off-by-one in the loop bound — 519 or 521 — now fails here), and
  // the two scripted extra steps are never consumed.
  expect(deps.calls).toHaveLength(SEED_MAX_WINDOWS)
})

test('already-done state is a no-op', async () => {
  const deps = makeDeps({ state: { done: true } })
  await runSeed(deps)
  expect(deps.calls).toHaveLength(0)
})

test('in-flight mutex: a second concurrent run is a no-op', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const deps = makeDeps({
    steps: [
      { items: [{ url: 'https://example.com/a', visitCount: 1, lastVisitTime: NOW }], gate },
      { items: [] },
      { items: [] },
    ],
  })
  const first = runSeed(deps)
  // The second synchronous invocation must not queue another walk.
  await runSeed(deps)
  expect(isSeedRunningForTests()).toBe(true)
  expect(deps.calls).toHaveLength(1)
  release()
  await first
  expect(isSeedRunningForTests()).toBe(false)
})
