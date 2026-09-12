import { test, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  buildSearchRecords,
  landingList,
} from './indexmodel'
import type { PageRecord, SearchRecord } from './types'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

beforeEach(() => {
  ;(globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

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

test('precomputes haystack as lowercased title + separator + url', () => {
  const [s] = buildSearchRecords([
    rec({ url: 'https://GitHub.com/pulls', title: 'Pulls' }),
  ])
  expect(s.haystack).toBe('pulls https://github.com/pulls')
})

test('precomputes titleLen = title.length + 1 (separator belongs to title segment)', () => {
  const [s] = buildSearchRecords([rec({ url: 'https://a.com/x', title: 'Page title' })])
  expect(s.titleLen).toBe('Page title'.length + 1)
})

test('empty title: haystack is " <url>" with titleLen 1', () => {
  const [s] = buildSearchRecords([rec({ url: 'https://a.com/x', title: '' })])
  expect(s.haystack).toBe(' https://a.com/x')
  expect(s.titleLen).toBe(1)
})

test('precomputes freq with the ranking model', () => {
  const [s] = buildSearchRecords([rec({ url: 'https://a.com', visitCount: 10, typedCount: 2 })])
  expect(s.freq).toBe(Math.log(1 + 10 + 2 * 2))
})

test('references: the built array holds one record object per url', () => {
  const records: SearchRecord[] = buildSearchRecords([
    rec({ url: 'https://a.com/x' }),
    rec({ url: 'https://a.com/y' }),
  ])
  expect(records[0].url).toBe('https://a.com/x')
  expect(records).toHaveLength(2)
})
test('landingList ranks pure frecency (unclamped) and stays stable on ties', () => {
  const input = buildSearchRecords([
    rec({ url: 'https://a.com/habit', visitCount: 20, typedCount: 5, lastVisit: NOW - DAY }),
    rec({ url: 'https://a.com/same-as-habit', visitCount: 20, typedCount: 5, lastVisit: NOW - DAY }),
    rec({ url: 'https://a.com/ancient', visitCount: 500, lastVisit: NOW - 400 * DAY }),
  ])
  const top = landingList(input, NOW, 3)
  // The landing list shows HABITS with unclamped pure frecency: the
  // ancient 500-visit megasite legitimately floats to the top (this
  // asymmetry with blend(…, clamp) is pinned in ranking.test.ts).
  // Identical scores arrive in load order (stable sort).
  expect(top.map((r) => r.url)).toEqual([
    'https://a.com/ancient',
    'https://a.com/habit',
    'https://a.com/same-as-habit',
  ])
  expect(input).toHaveLength(3) // landingList must not mutate the input
})

test('landingList slices to the requested count', () => {
  const input = buildSearchRecords(
    Array.from({ length: 25 }, (_, i) => rec({ url: `https://a.com/${i}` })),
  )
  expect(landingList(input, NOW, 10)).toHaveLength(10)
})

test('empty index → empty structures everywhere', () => {
  expect(buildSearchRecords([])).toEqual([])
  expect(landingList([], NOW)).toEqual([])
})
