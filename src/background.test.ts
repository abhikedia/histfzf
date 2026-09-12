import { test, expect, beforeAll, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  SEED_DONE_KEY,
  SEED_MAX_RESULTS,
  SEED_WM_KEY,
} from './constants'
import { DEFAULT_SETTINGS } from './settings'
import { installChromeMock } from './test-harness'
import { resetForTests } from './db'
import * as db from './db'
import type { PageRecord } from './types'

// The SW entry attaches listeners at module scope AND runs a resume
// check against storage — the chrome mock must exist before import.
// vi.mock the CRXJS-injected dynamic-content-script path (it cannot
// resolve outside a Vite extension build); the stub stands in for the
// built loader filename so the executeScript assertions can use it.
vi.mock('./content?script', () => ({
  default: 'assets/content.ts-loader-FIXTURE.js',
}))

import type { ChromeHarness } from './test-harness'

let harness: ChromeHarness

beforeAll(async () => {
  harness = installChromeMock()
  await import('./background')
})

const OVERLAY_TAB_URL =
  'chrome-extension://test/src/overlay/index.html?mode=tab'

beforeEach(async () => {
  await resetForTests()
  ;(globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  harness.reset()
})

test('all five chrome event surfaces have exactly one listener registered', () => {
  expect(harness.listeners.onInstalled).toHaveLength(1)
  expect(harness.listeners.onCommand).toHaveLength(1)
  expect(harness.listeners.onVisited).toHaveLength(1)
  expect(harness.listeners.onUpdated).toHaveLength(1)
  expect(harness.listeners.onMessage).toHaveLength(1)
})

test('onVisited routes to recordVisit: canonical key, raw url, typed flag', async () => {
  harness.listeners.onVisited[0]({
    url: 'https://GitHub.com/pulls?utm_source=x',
    lastVisitTime: 12345,
    typedCount: 2,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const rows: PageRecord[] = await db.getAll()
  expect(rows).toHaveLength(1)
  expect(rows[0].url).toBe('https://github.com/pulls')
  expect(rows[0].rawUrl).toBe('https://GitHub.com/pulls?utm_source=x')
  expect(rows[0].visitCount).toBe(1)
  expect(rows[0].typedCount).toBe(1)
  expect(rows[0].lastVisit).toBe(12345)
})

test('onVisited skips unsafe urls: nothing is stored', async () => {
  harness.listeners.onVisited[0]({ url: 'chrome://extensions' } as never)
  harness.listeners.onVisited[0]({ url: 'garbage' } as never)
  harness.listeners.onVisited[0]({} as never)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(await db.getAll()).toEqual([])
})

test('onUpdated routes to updateTitle: writes, absorbs redundant fires, skips missing url', async () => {
  await db.recordVisit('https://example.com/x', 'https://example.com/x', 1, false)
  harness.listeners.onUpdated[0](
    7,
    { title: 'Real title' },
    { url: 'https://example.com/x' },
  )
  harness.listeners.onUpdated[0](7, { title: 'Real title' }, { url: 'https://example.com/x' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const start = await db.getAll()
  expect(start[0].title).toBe('Real title')

  // No url → the listener returns before touching the db.
  harness.listeners.onUpdated[0](7, { title: 'ignored' }, undefined as never)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(await db.getAll()).toEqual(start)
})

test('onCommand: non-palette commands are ignored entirely', () => {
  harness.listeners.onCommand[0]('something-else', harness.activeTab)
  expect(harness.callLog).toEqual([])
})

test('onCommand: normal https tab → scripting.executeScript with the loader file', () => {
  harness.listeners.onCommand[0]('toggle-palette', {
    id: 7,
    url: 'https://news.example/article',
  })
  expect(harness.callLog).toEqual([
    {
      kind: 'scripting.executeScript',
      args: {
        target: { tabId: 7 },
        files: ['assets/content.ts-loader-FIXTURE.js'],
      },
    },
  ])
})

test('onCommand: chrome:// tab → opens the disposable palette tab', () => {
  harness.listeners.onCommand[0]('toggle-palette', { id: 7, url: 'chrome://settings' })
  expect(harness.callLog).toEqual([
    {
      kind: 'tabs.create',
      args: { url: OVERLAY_TAB_URL },
    },
  ])
})

test('onCommand: palette tab focused → toggles closed (remove, not stack)', async () => {
  harness.tabs.set(9, { id: 9, url: OVERLAY_TAB_URL })
  await harness.listeners.onCommand[0]('toggle-palette', { id: 9, url: OVERLAY_TAB_URL })
  expect(harness.callLog).toEqual([
    {
      kind: 'tabs.remove',
      args: 9,
    },
  ])
})

test('onCommand: empty-URL tab (chrome has not committed a url yet) falls back to the palette tab', () => {
  harness.listeners.onCommand[0]('toggle-palette', { id: 7, url: '' })
  expect(harness.callLog).toEqual([
    {
      kind: 'tabs.create',
      args: { url: OVERLAY_TAB_URL },
    },
  ])
})

test('onMessage: GET_INDEX resolves async with the current records', async () => {
  await db.recordVisit('https://example.com/a', 'https://example.com/a', 1, false)
  const listener = harness.listeners.onMessage[0]
  let responded: unknown
  let keepOpen: boolean = false
  keepOpen = listener({ type: 'GET_INDEX' }, {}, (resp) => {
    responded = resp
  }) === true
  expect(keepOpen).toBe(true) // the async-response channel must hold open
  // Two async hops now (db read + settings read) — wait on the RESOLVE
  // signal with a bounded loop instead of a fixed tick.
  for (let i = 0; i < 100 && responded === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(responded).toEqual({
    records: [
      expect.objectContaining({ url: 'https://example.com/a' }),
    ],
    settings: DEFAULT_SETTINGS, // nothing in storage yet → factory weights
  })
})

test('onMessage: OPEN_NEW_TAB routes to tabs.create', () => {
  harness.listeners.onMessage[0](
    { type: 'OPEN_NEW_TAB', url: 'https://example.com/target' },
    {},
    () => undefined,
  )
  expect(
    harness.callLog.filter((c) => c.kind === 'tabs.create'),
  ).toEqual([
    {
      kind: 'tabs.create',
      args: { url: 'https://example.com/target' },
    },
  ])
})

test('onMessage: RESTORE_TAB removes the sender tab (the palette owns a top-level tab)', () => {
  harness.tabs.set(11, { id: 11, url: OVERLAY_TAB_URL })
  harness.listeners.onMessage[0](
    { type: 'RESTORE_TAB' },
    { tab: { id: 11 } },
    () => undefined,
  )
  expect(harness.callLog.filter((c) => c.kind === 'tabs.remove')).toEqual([
    {
      kind: 'tabs.remove',
      args: 11,
    },
  ])
})

test('onMessage: RESTORE_TAB without a sender.tab (iframe/popup mode) does nothing', () => {
  harness.listeners.onMessage[0]({ type: 'RESTORE_TAB' }, {}, () => undefined)
  expect(harness.callLog.filter((c) => c.kind === 'tabs.remove')).toEqual([])
})

// -- Omnibox wiring ---------------------------------------------------------

test('omnibox: typing triggers one index load per wake session; suggestions flow', async () => {
  expect(harness.listeners.onInputStarted).toHaveLength(1)
  expect(harness.listeners.onInputChanged).toHaveLength(1)
  expect(harness.listeners.onInputEntered).toHaveLength(1)

  // The suggestions come from the DB (fake-indexeddb), not history.
  await db.importHistoryItem({
    url: 'https://github.com/pull-requests',
    title: 'GitHub PRs',
    visitCount: 10,
    lastVisitTime: 12345,
  })
  // onInputChanged builds the session cache lazily — no pre-priming.
  let suggestions: Array<{ content: string; description: string; iconUrl?: string }> | undefined
  harness.listeners.onInputChanged[0]('ghpr', (result) => {
    suggestions = result
  })
  await flushUntil(() => suggestions !== undefined)
  expect(suggestions).toHaveLength(1)
  expect(suggestions?.[0].content).toBe('https://github.com/pull-requests')
  expect(suggestions?.[0].description).toBe(
    '<dim>GitHub PRs</dim> <match>https://github.com/pull-requests</match>',
  )
  // The row icon rides in the same payload (nodoc omnibox field).
  expect(suggestions?.[0].iconUrl).toBe(
    'chrome-extension://test/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2Fpull-requests&size=16',
  )
}, 10_000)

test('omnibox: currentTab disposition updates the active tab with the rawUrl', async () => {
  harness.tabs.set(21, { id: 21, url: 'chrome://new-tab' })
  harness.activeTab.id = 21
  await harness.listeners.onInputEntered[0](
    'https://example.com/opened',
    'currentTab',
  )
  const updates = harness.callLog.filter((c) => c.kind === 'tabs.update')
  expect(updates).toEqual([
    { kind: 'tabs.update', args: { tabId: 21, url: 'https://example.com/opened' } },
  ])
})

test.each([
  ['newForegroundTab', true],
  ['newBackgroundTab', false],
])('omnibox: %s disposition creates a tab with active=%s', async (disposition, active) => {
  await harness.listeners.onInputEntered[0]('https://example.com/new', disposition)
  expect(
    harness.callLog.filter((c) => c.kind === 'tabs.create'),
  ).toEqual([
    { kind: 'tabs.create', args: { url: 'https://example.com/new', active } },
  ])
})

test('omnibox: non-URL input (typed words without a suggestion) is ignored', async () => {
  await harness.listeners.onInputEntered[0](
    'this is just typed text',
    'currentTab',
  )
  expect(harness.callLog).toEqual([])
})

// -- Seed wiring through the chrome bridge ---------------------------------

function flushUntil(condition: () => boolean, max = 200): Promise<void> {
  return (async () => {
    for (let i = 0; i < max && !condition(); i++) {
      // give the fire-and-forget seed loop its next microtask slice
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })()
}

test('onInstalled(reason=install) seeds through the chrome bridge', async () => {
  // Script two windows: one with a record, two empties (the stop cap).
  harness.historyQueue.push(
    [
      {
        url: 'https://GitHub.com/pulls?utm_source=x',
        visitCount: 2,
        typedCount: 1,
        lastVisitTime: 12345,
      },
    ],
    [],
    [],
  )
  harness.listeners.onInstalled[0]({ reason: 'install' })
  await flushUntil(() => harness.store.get(SEED_DONE_KEY) === true)

  // The search reached chrome.history with the real query shape —
  // dropping maxResults or mangling the range is invisible otherwise.
  const searches = harness.callLog.filter((c) => c.kind === 'history.search')
  expect(searches[0].args).toEqual(
    expect.objectContaining({ text: '', maxResults: SEED_MAX_RESULTS }),
  )
  expect(harness.store.get(SEED_DONE_KEY)).toBe(true)
  expect(harness.store.get(SEED_WM_KEY)).toBeUndefined() // cleared on completion
  const rows: PageRecord[] = await db.getAll()
  expect(rows.map((r) => r.url)).toEqual(['https://github.com/pulls'])
})

test('onInstalled(reason=update) does not seed again', async () => {
  harness.listeners.onInstalled[0]({ reason: 'update' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(
    harness.callLog.filter((c) => c.kind === 'history.search'),
  ).toEqual([])
})

test('onCommand without a tab argument falls back to tabs.query then injects', async () => {
  await harness.listeners.onCommand[0]('toggle-palette', undefined)
  const kinds = harness.callLog.map((c) => c.kind)
  expect(kinds).toEqual(['tabs.query', 'scripting.executeScript'])
  const inject = harness.callLog[1]
  expect((inject.args as { target: { tabId: number } }).target.tabId).toBe(7)
})
