import { test, expect } from 'vitest'
import {
  createFzf,
  search,
  segmentMatches,
  type NarrowState,
} from './search'
import { DAY_MS, RENDER_CAP, FZF_POOL_SIZE } from '../constants'
import type { SearchRecord } from '../types'

const NOW = 1_700_000_000_000
const DAY = DAY_MS

function rec(partial: Partial<SearchRecord> & { url: string; title: string }): SearchRecord {
  return {
    rawUrl: partial.url,
    host: 'example.com',
    visitCount: 1,
    typedCount: 0,
    firstVisit: NOW,
    lastVisit: NOW,
    haystack: `${partial.title} ${partial.url}`.toLowerCase(),
    titleLen: partial.title.length + 1,
    freq: Math.log(1 + (partial.visitCount ?? 1) + 2 * (partial.typedCount ?? 0)),
    ...partial,
  }
}

const github = rec({
  url: 'https://github.com/pull-requests',
  title: 'GitHub',
  visitCount: 10,
  typedCount: 2,
})
const docs = rec({
  url: 'https://docs.aws.amazon.com',
  title: 'Docs',
  visitCount: 3,
})
const fresh = rec({
  url: 'https://news.example/article',
  title: 'News',
  visitCount: 1,
  lastVisit: NOW - DAY, // fresher than NOW - 10*DAY records
})

const records = [github, docs, fresh]
const fzf = createFzf(records)

function run(query: string, state: NarrowState = { query: '', pool: null }) {
  return search(fzf, state, query, NOW)
}

test('subsequence: `ghpr` matches the GitHub PRs page, nothing else', () => {
  const { rows } = run('ghpr')
  expect(rows.map((r) => r.record.url)).toEqual(['https://github.com/pull-requests'])
})

test('positions are increasing indices into the haystack (fzf order)', () => {
  const { rows } = run('ghpr')
  const positions = [...rows[0].positions].sort((a, b) => a - b)
  expect(positions.length).toBeGreaterThanOrEqual(4)
  for (let i = 1; i < positions.length; i++) {
    expect(positions[i]).toBeGreaterThan(positions[i - 1])
  }
  const haystack = rows[0].record.haystack
  // And they spell the query — subsequence confirmed on real indices.
  expect(positions.map((p) => haystack[p]).join('')).toBe('ghpr')
})

test('segment mapping: titleLen splits positions across title and URL segments', () => {
  // ghpr fixture: fzf's score-optimal match for THIS record lands all
  // four chars in the URL (the title has a valid subsequence too, but
  // URL positions score higher). The split contract: in-segment indices
  // are haystack minus the segment offset; a segment with no matches
  // stays plain.
  const { rows } = run('ghpr')
  const { record, positions } = rows[0]
  const inTitle = segmentMatches(record.title, positions, 0)
  const inUrl = segmentMatches(record.url, positions, record.titleLen)
  expect(inTitle.size).toBe(0)
  const urlChars = [...inUrl].sort((a, b) => a - b).map((i) => record.url[i])
  expect(urlChars.join('')).toBe('ghpr')
})

test('blend orders: frequent+typed habit first when both match well', () => {
  const habit = rec({
    url: 'https://example.com/gha',
    title: 'Github actions',
    visitCount: 50,
    typedCount: 5,
  })
  const cold = rec({
    url: 'https://example.com/ghb',
    title: 'Github about',
    visitCount: 1,
  })
  const local = createFzf([habit, cold])
  const { rows } = search(local, { query: '', pool: null }, 'github', NOW)
  expect(rows.map((r) => r.record.url)).toEqual([
    'https://example.com/gha',
    'https://example.com/ghb',
  ])
})

test('lastVisit tie-break: equally scored records favor the fresher one', () => {
  const stale = rec({ url: 'https://example.com/a', title: 'Same page', lastVisit: NOW - 10 * DAY })
  const freshr = rec({ url: 'https://example.com/b', title: 'Same page', lastVisit: NOW - DAY })
  const local = createFzf([stale, freshr])
  const { rows } = search(local, { query: '', pool: null }, 'same', NOW)
  expect(rows[0].record.url).toBe('https://example.com/b')
})

test('incremental narrowing: growing the query only re-scans the previous pool', () => {
  const first = run('gh')
  expect(first.rows.length).toBeGreaterThanOrEqual(1)
  // Grow with the previous pool persisted — must still find `ghpr`.
  const second = run('ghpr', { query: 'gh', pool: first.pool })
  expect(second.rows[0].record.url).toBe('https://github.com/pull-requests')
  // The narrowed pass cannot lose items the full pool had: the docs
  // page (a `gh` subsequence match? no — 'ghpr' never in docs haystack)
  // is not required here, but the result must be consistent with a
  // full re-run.
  const fromScratch = run('ghpr')
  expect(second.rows.map((r) => r.record.url)).toEqual(fromScratch.rows.map((r) => r.record.url))
})

test('narrowing to a non-matching query yields an empty pool; next full reset re-searches', () => {
  const first = run('zzz')
  expect(first.rows).toEqual([])
  expect(first.pool).toEqual([])
  // A different, non-prefix query restarts from the full index.
  const second = run('ghpr')
  expect(second.rows[0].record.url).toBe('https://github.com/pull-requests')
})

test('pool honors FZF_POOL_SIZE while rows honor RENDER_CAP', () => {
  // Beat both caps: RENDER_CAP=50 rows, pool ≤500.
  expect(FZF_POOL_SIZE).toBeGreaterThan(RENDER_CAP)
  const many = Array.from({ length: FZF_POOL_SIZE + 50 }, (_, i) =>
    rec({ url: `https://example.com/p/${i}`, title: 'Page', visitCount: 1, lastVisit: NOW - i * DAY }),
  )
  const local = createFzf(many)
  const { rows, pool } = search(local, { query: '', pool: null }, 'page', NOW)
  expect(pool.length).toBeLessThanOrEqual(FZF_POOL_SIZE)
  expect(rows.length).toBe(RENDER_CAP)
})

test('segmentMatches ignores out-of-segment indices', () => {
  expect(segmentMatches('ab', new Set([-1, 0, 2, 9]), 0)).toEqual(new Set([0]))
  expect(segmentMatches('ab', new Set([1]), 1)).toEqual(new Set([0]))
})
