import {
  DAY_MS,
  FRECENCY_CAP,
  RECENCY_HALFLIFE_DAYS,
  TYPED_WEIGHT,
  W_FRECENCY_FREQ,
  W_FRECENCY_REC,
} from './constants'
import type { PageRecord } from './types'

/**
 * Ranking model: fzf owns WHAT matches, frecency only
 * nudges the order among comparable matches. All functions are pure and
 * take `nowMs` explicitly — no Date.now() — so results are testable.
 */

/** Frequency half of frecency, log-compressed so megasites cannot
 * dominate by scale alone. Typed visits (the URL was actually typed)
 * weigh TYPED_WEIGHT× — Chrome tracks this distinction for free. */
export function computeFreq(visitCount: number, typedCount: number): number {
  return Math.log(1 + visitCount + TYPED_WEIGHT * typedCount)
}

/** Recency half: exponential decay over RECENCY_HALFLIFE_DAYS. A visit
 * from now is worth 1; two weeks stale ≈ 0.37; a month ≈ 0.11. The
 * max(0, …) clamp guards clock skew (a lastVisit in the future would
 * otherwise yield rec > 1). */
export function computeRec(lastVisitMs: number, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - lastVisitMs) / DAY_MS)
  return Math.exp(-ageDays / RECENCY_HALFLIFE_DAYS)
}

/** The bounded, multiplicative blend. The FRECENCY_CAP clamp is the
 * core guarantee: frecency can at most double a match score — habitual
 * pages float up but can never swamp a clearly better fuzzy match. */
export function blend(fzfScore: number, freq: number, rec: number): number {
  const frecency = W_FRECENCY_FREQ * freq + W_FRECENCY_REC * rec
  return fzfScore * (1 + Math.min(frecency, FRECENCY_CAP))
}

/** "Pure frecency" score for the empty-query landing list (no fzf at
 * all). Same two halves, no blend with any match score. */
export function frecencyScore(record: PageRecord, nowMs: number): number {
  return (
    W_FRECENCY_FREQ * computeFreq(record.visitCount, record.typedCount) +
    W_FRECENCY_REC * computeRec(record.lastVisit, nowMs)
  )
}
