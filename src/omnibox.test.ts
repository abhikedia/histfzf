import { test, expect } from 'vitest'
import { buildSuggestions, toOmniboxEntry } from './omnibox'
import type { PageRecord, SearchRecord } from './types'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function searchRecordFor(partial: Partial<PageRecord> & { url: string }): PageRecord {
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

function rec(partial: Partial<PageRecord> & { url: string }): SearchRecord & PageRecord {
  const page = searchRecordFor(partial)
  return {
    ...page,
    haystack: `${page.title} ${page.url}`.toLowerCase(),
    titleLen: page.title.length + 1,
    freq: Math.log(1 + page.visitCount + 2 * page.typedCount),
  }
}

test('toOmniboxEntry: dim title + matched URL markup, rawUrl content', () => {
  const entry = toOmniboxEntry({
    ...rec({ url: 'https://a.com', rawUrl: 'https://a.com/page?q=1' }),
    title: 'A page title',
  })
  expect(entry.content).toBe('https://a.com/page?q=1')
  expect(entry.description).toBe(
    '<dim>A page title</dim> <match>https://a.com/page?q=1</match>',
  )
})

test('toOmniboxEntry: empty title → URL is the only line', () => {
  const entry = toOmniboxEntry({
    ...rec({ url: 'https://a.com', rawUrl: 'https://a.com/x' }),
    title: '',
  })
  expect(entry.content).toBe('https://a.com/x')
  expect(entry.description).toBe('<match>https://a.com/x</match>')
})

test('markup-unsafe text is escaped (titles with <, >, & cannot break Chrome)', () => {
  const entry = toOmniboxEntry({
    ...rec({ url: 'https://a.com', rawUrl: 'https://a.com/x?a<1&b>2' }),
    title: 'C++ <templates> & atoms',
  })
  expect(entry.description).toBe(
    '<dim>C++ &lt;templates&gt; &amp; atoms</dim> <match>https://a.com/x?a&lt;1&amp;b&gt;2</match>',
  )
})

test('empty query → up to 6 entries ordered by pure frecency', () => {
  const entries = buildSuggestions(
    [
      rec({ url: 'https://a.com/', visitCount: 500, lastVisit: NOW - 400 * DAY }),
      rec({ url: 'https://a.com/b', visitCount: 50, typedCount: 9, lastVisit: NOW - DAY }),
      rec({ url: 'https://a.com/c' }),
      rec({ url: 'https://a.com/d' }),
      rec({ url: 'https://a.com/e' }),
      rec({ url: 'https://a.com/f' }),
      rec({ url: 'https://a.com/g' }),
      rec({ url: 'https://a.com/h' }),
    ],
    '',
    NOW,
  )
  expect(entries.length).toBeLessThanOrEqual(6)
})

test('frecency order sanity: the landing list semantics carry over verbatim', () => {
  // The unclamped-frecency pin from indexmodel: a massively-visited
  // ancient page legitimately tops the empty-query list.
  const entries = buildSuggestions(
    [
      rec({ url: 'https://a.com/b', visitCount: 50, typedCount: 9, lastVisit: NOW - DAY }),
      rec({ url: 'https://a.com/mega', visitCount: 5000, lastVisit: NOW - 400 * DAY }),
    ],
    '',
    NOW,
  )
  expect(entries[0].content).toBe('https://a.com/mega')
  expect(entries).toHaveLength(2)
})

test('query → fzf-blend entries, no more than 6, content is navigable', () => {
  const entries = buildSuggestions(
    [
      rec({ url: 'https://github.com/pull-requests', title: 'GitHub PRs', visitCount: 10 }),
      rec({ url: 'https://github.com/actions', title: 'Actions' }),
      rec({ url: 'https://unrelated.example.com/', title: 'Unrelated' }),
    ],
    'ghpr',
    NOW,
  )
  expect(entries.length).toBeGreaterThanOrEqual(1)
  expect(entries.length).toBeLessThanOrEqual(6)
  expect(entries[0].content).toBe('https://github.com/pull-requests')
  expect(entries[0].description).toContain('<dim>GitHub PRs</dim>')
})

test('no matches → empty suggestions (Chrome shows the default fallback)', () => {
  const entries = buildSuggestions(
    [rec({ url: 'https://a.com/x', title: 'X' })],
    'zzzz',
    NOW,
  )
  expect(entries).toEqual([])
})

test('empty index → empty suggestions even with a query', () => {
  expect(buildSuggestions([], 'github', NOW)).toEqual([])
})
