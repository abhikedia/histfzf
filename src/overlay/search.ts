import { Fzf } from 'fzf'
import { FZF_POOL_SIZE, RENDER_CAP } from '../constants'
import { blend, computeRec, DEFAULT_WEIGHTS, type RankingWeights } from '../ranking'
import type { SearchRecord } from '../types'

/**
 * The search pipeline (per keystroke, all in RAM):
 *   1. fzf pass     — subsequence matching over precomputed haystacks,
 *                     capped at FZF_POOL_SIZE (larger than RENDER_CAP on
 *                     purpose, so frecency can reshuffle inside the
 *                     pool before the render cut)
 *   2. blend        — bounded frecency multiplier on each entry
 *   3. sort + cut   — descending blended score, lastVisit tie-break,
 *                     slice to RENDER_CAP
 * Incremental narrowing: when the query only GREW, the pass re-runs
 * over the previous pool (≤500 items) instead of the whole index; any
 * non-prefix change restarts from the full heap. The caller persists
 * the returned pool for the next keystroke — this module stays
 * stateless.
 */

export type IndexFinder = Fzf<ReadonlyArray<SearchRecord>>

export function createFzf(records: readonly SearchRecord[]): IndexFinder {
  return new Fzf(records, {
    selector: (record) => record.haystack,
    limit: FZF_POOL_SIZE,
  })
}

export interface RankedRow {
  record: SearchRecord
  /** Indices into the record's haystack (fzf's positions) — the app
   * maps these back to the title vs URL segment via titleLen. */
  positions: ReadonlySet<number>
}

export interface NarrowState {
  query: string
  pool: SearchRecord[] | null
}

export interface SearchResult {
  rows: RankedRow[]
  /** The full ordered pool from this pass, for the next keystroke's
   * narrowing (callers persist it in a ref). */
  pool: SearchRecord[]
}

export function search(
  fzf: IndexFinder,
  state: NarrowState,
  query: string,
  nowMs: number,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): SearchResult {
  const lower = query.toLowerCase()
  // Narrow inline so TypeScript connects the canNarrow condition with
  // the pool's non-null access — no casts anywhere.
  const matched =
    state.pool !== null && state.query.length > 0 && lower.startsWith(state.query)
      ? createFzf(state.pool).find(lower)
      : fzf.find(lower)

  // Blend BEFORE the render cut: frecency must be able to promote
  // anything inside the 500-row pool, or habitual pages would never
  // surface above equally-matching cold ones.
  const blended = matched
    .map((entry) => ({
      entry,
      final: blend(
        entry.score,
        entry.item.freq,
        computeRec(entry.item.lastVisit, nowMs, weights),
        weights,
      ),
    }))
    .sort(
      (a, b) =>
        b.final - a.final ||
        b.entry.item.lastVisit - a.entry.item.lastVisit,
    )

  const pool = blended.map((b) => b.entry.item)
  return {
    rows: blended.slice(0, RENDER_CAP).map((b) => ({
      record: b.entry.item,
      positions: b.entry.positions,
    })),
    pool,
  }
}

/**
 * Highlight mapping: which haystack indices fall in this segment, as
 * in-segment character indices. The app renders one segment per line
 * (title segment at offset 0, URL segment at offset titleLen); a
 * segment with no matches renders plain.
 */
export function segmentMatches(
  text: string,
  positions: ReadonlySet<number>,
  offset: number,
): Set<number> {
  const inSegment = new Set<number>()
  for (const index of positions) {
    if (index >= offset && index < offset + text.length) {
      inSegment.add(index - offset)
    }
  }
  return inSegment
}
