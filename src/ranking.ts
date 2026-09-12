import { DAY_MS, TYPED_WEIGHT } from './constants'
import { DEFAULT_SETTINGS, type HistFzfSettings } from './settings'
import type { PageRecord } from './types'

/**
 * Ranking model: fzf owns WHAT matches, frecency only nudges the order
 * among comparable matches. All functions are pure and take `nowMs`
 * explicitly — no Date.now() — so results are testable.
 *
 * The weights are tunable from the options page (settings.ts); these
 * defaults mirror the factory tokens. computeFreq keeps TYPED_WEIGHT
 * fixed — typed-vs-clicked is a structural distinction, not a mood knob.
 */

// The weight knobs ARE the settings keys — one source of truth
// (settings.ts), no drift between the options page and the ranker.
export type RankingWeights = HistFzfSettings

export const DEFAULT_WEIGHTS: RankingWeights = DEFAULT_SETTINGS

/** Frequency half of frecency, log-compressed so megasites cannot
 * dominate by scale alone. Typed visits (the URL was actually typed)
 * weigh TYPED_WEIGHT× — Chrome tracks this distinction for free. */
export function computeFreq(visitCount: number, typedCount: number): number {
  return Math.log(1 + visitCount + TYPED_WEIGHT * typedCount)
}

/** Recency half: exponential decay over the halflife horizon (days).
 * A visit from now is worth 1; two weeks stale ≈ 0.37; a month ≈ 0.11.
 * The max(0, …) clamp guards clock skew (a lastVisit in the future
 * would otherwise yield rec > 1). */
export function computeRec(
  lastVisitMs: number,
  nowMs: number,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): number {
  const ageDays = Math.max(0, (nowMs - lastVisitMs) / DAY_MS)
  return Math.exp(-ageDays / weights.halflifeDays)
}

/** The bounded, multiplicative blend. The clamp is the core guarantee:
 * frecency can at most (1 + cap)× a match score — habitual pages float
 * up but can never swamp a clearly better fuzzy match. */
export function blend(
  fzfScore: number,
  freq: number,
  rec: number,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): number {
  const frecency = weights.wf * freq + weights.wr * rec
  return fzfScore * (1 + Math.min(frecency, weights.cap))
}

/** "Pure frecency" score for the empty-query landing list (no fzf at
 * all). Same two halves, no blend with any match score. */
export function frecencyScore(
  record: PageRecord,
  nowMs: number,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): number {
  return (
    weights.wf * computeFreq(record.visitCount, record.typedCount) +
    weights.wr * computeRec(record.lastVisit, nowMs, weights)
  )
}
