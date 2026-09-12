import { test, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import * as db from './db'
import type { PageRecord } from './types'

beforeEach(async () => {
  await db.resetForTests()
  // fake-indexeddb exports a factory we can swap for a fresh one —
  // no cross-test state survives.
  const fakeGlobal = globalThis as unknown as {
    indexedDB?: IDBFactory
  }
  fakeGlobal.indexedDB = new IDBFactory()
})

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function rec(partial: Partial<PageRecord> & { url: string }): PageRecord {
  return {
    rawUrl: partial.url,
    title: '',
    host: 'example.com',
    visitCount: 1,
    typedCount: 0,
    firstVisit: NOW,
    lastVisit: NOW,
    ...partial,
  }
}

test('recordVisit creates a missing record with empty title', async () => {
  await db.recordVisit('https://example.com/a', 'https://example.com/a', NOW, true)
  const [record] = await db.getAll()
  expect(record).toMatchObject({
    url: 'https://example.com/a',
    visitCount: 1,
    typedCount: 1,
    title: '',
    firstVisit: NOW,
    lastVisit: NOW,
  })
})

test('recordVisit increments counts and moves lastVisit', async () => {
  const key = 'https://example.com/a'
  await db.recordVisit(key, 'https://example.com/a', NOW, false)
  await db.recordVisit(key, 'https://example.com/a?x=1', NOW + DAY, true)
  await db.recordVisit(key, 'https://example.com/a', NOW + 2 * DAY, false)
  const [record] = await db.getAll()
  expect(record).toMatchObject({
    visitCount: 3,
    typedCount: 1,
    firstVisit: NOW,
    lastVisit: NOW + 2 * DAY,
    rawUrl: 'https://example.com/a',
  })
})

test('recordVisit never touches the title', async () => {
  const key = 'https://example.com/a'
  await db.importHistoryItem({
    url: key,
    title: 'Known title',
    visitCount: 5,
    typedCount: 1,
    lastVisitTime: NOW,
  })
  await db.recordVisit(key, key, NOW + DAY, false)
  const [record] = await db.getAll()
  expect(record.title).toBe('Known title')
  expect(record.visitCount).toBe(6)
})

test('importHistoryItem creates with chrome aggregates', async () => {
  await db.importHistoryItem({
    url: 'https://example.com/a',
    title: 'Page A',
    visitCount: 7,
    typedCount: 2,
    lastVisitTime: NOW,
  })
  const [record] = await db.getAll()
  expect(record).toMatchObject({
    url: 'https://example.com/a',
    title: 'Page A',
    visitCount: 7,
    typedCount: 2,
    lastVisit: NOW,
    host: 'example.com',
  })
})

test('importHistoryItem skips non-http(s) urls without writing', async () => {
  await db.importHistoryItem({ url: 'chrome://extensions', visitCount: 1 })
  await db.importHistoryItem({ url: 'not a url', visitCount: 1 })
  expect(await db.getAll()).toEqual([])
})

test('importHistoryItem merge takes max counts / min firstVisit / max lastVisit', async () => {
  const key = 'https://example.com/a'
  await db.importHistoryItem({
    url: key,
    title: 'First',
    visitCount: 5,
    typedCount: 2,
    lastVisitTime: NOW,
  })
  // A second seed window redelivers the same URL's aggregates (possibly
  // shifted in time) — merge must never ADD, taking max()/min() instead.
  await db.importHistoryItem({
    url: `${key}/`,
    title: 'Second',
    visitCount: 6,
    typedCount: 1,
    lastVisitTime: NOW + DAY,
  })
  const [record] = await db.getAll()
  expect(record).toMatchObject({
    visitCount: 6,
    typedCount: 2,
    firstVisit: NOW,
    lastVisit: NOW + DAY,
    title: 'First',
    rawUrl: `${key}/`,
  })
})

test('updateTitle writes when it changes', async () => {
  const key = 'https://example.com/a'
  await db.importHistoryItem({ url: key, visitCount: 1, lastVisitTime: NOW })
  await db.updateTitle(key, 'Real title')
  const [record] = await db.getAll()
  expect(record.title).toBe('Real title')
})

test('updateTitle no-ops on missing record', async () => {
  await expect(
    db.updateTitle('https://example.com/ghost', 'Ghost'),
  ).resolves.toBeUndefined()
  expect(await db.getAll()).toEqual([])
})

test('updateTitle no-ops on empty or unchanged title', async () => {
  const key = 'https://example.com/a'
  await db.importHistoryItem({
    url: key,
    title: 'Title',
    visitCount: 1,
    lastVisitTime: NOW,
  })
  await db.updateTitle(key, '')
  await db.updateTitle(key, 'Title')
  const [record] = await db.getAll()
  expect(record.title).toBe('Title')
})

test('bulkPut + getAll round-trips keyed by canonical url', async () => {
  await db.bulkPut([
    rec({ url: 'https://example.com/a' }),
    rec({ url: 'https://example.com/b' }),
    rec({ url: 'https://example.com/a' }), // put = upsert: a stays one row
  ])
  const all = await db.getAll()
  expect(all).toHaveLength(2)
  expect(new Set(all.map((r) => r.url))).toEqual(
    new Set(['https://example.com/a', 'https://example.com/b']),
  )
})

test('pruneBefore deletes only older records', async () => {
  await db.bulkPut([
    rec({ url: 'https://example.com/old', lastVisit: NOW - 10 * DAY }),
    rec({ url: 'https://example.com/edge', lastVisit: NOW }),
    rec({ url: 'https://example.com/new', lastVisit: NOW + DAY }),
  ])
  const deleted = await db.pruneBefore(NOW)
  expect(deleted).toBe(1)
  const remaining = (await db.getAll()).map((r) => r.url)
  expect(remaining).toEqual(
    expect.arrayContaining([
      'https://example.com/edge',
      'https://example.com/new',
    ]),
  )
  expect(remaining).not.toContain('https://example.com/old')
})

