import { LANDING_SIZE } from './constants'
import { computeFreq, frecencyScore } from './ranking'
import type { PageRecord, SearchRecord } from './types'

/**
 * The overlay's in-memory index model.
 *
 * Built ONCE per index load (one GET_INDEX message per palette open),
 * never per keystroke:
 *   - Array<SearchRecord> — same object references, the scan target
 * Each record precomputes the search-time work exactly once:
 *   - haystack: the lowercased `title + " " + url` string a fuzzy
 *     matcher scans (precomputing avoids re-concatenating 50k strings
 *     per keystroke — the single biggest search-time win)
 *   - titleLen: title-length + 1 (the separator space belongs to the
 *     title segment) — maps match positions back to title vs URL
 *   - freq: the frequency half of frecency, recomputed only on reload
 */

export function buildSearchRecords(
  records: PageRecord[],
): SearchRecord[] {
  return records.map((record) => ({
    ...record,
    haystack: `${record.title} ${record.url}`.toLowerCase(),
    titleLen: record.title.length + 1,
    freq: computeFreq(record.visitCount, record.typedCount),
  }))
}

/**
 * Empty-query landing list: pure frecency (no fuzzy match at all).
 * Sort by Wf*freq + Wr*rec descending; Array.prototype.sort is stable,
 * so ties keep load order — deterministic in tests.
 */
export function landingList(
  records: SearchRecord[],
  nowMs: number,
  count: number = LANDING_SIZE,
): SearchRecord[] {
  return [...records]
    .sort(
      (a, b) => frecencyScore(b, nowMs) - frecencyScore(a, nowMs),
    )
    .slice(0, count)
}
