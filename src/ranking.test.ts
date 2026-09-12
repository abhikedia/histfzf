import { test, expect } from 'vitest'
import {
  blend,
  computeFreq,
  computeRec,
  frecencyScore,
} from './ranking'
import { DAY_MS } from './constants'
import type { PageRecord } from './types'

const NOW = 1_700_000_000_000

test('computeFreq: fresh page scores 0', () => {
  expect(computeFreq(0, 0)).toBe(0)
})

test('computeFreq: habitual page (10 visits, 2 typed) = ln(15)', () => {
  expect(computeFreq(10, 2)).toBeCloseTo(Math.log(15), 10)
})

test('computeFreq: typed visits weigh double', () => {
  expect(computeFreq(1, 1)).toBe(computeFreq(3, 0))
  expect(computeFreq(10, 0)).toBeLessThan(computeFreq(10, 2))
})

test('computeFreq: log compression keeps megasites in check', () => {
  // 10x the visits must NOT be 10x the freq
  const small = computeFreq(10, 0)
  const big = computeFreq(100, 0)
  expect(big / small).toBeLessThan(2)
})

test('computeRec: just visited = 1', () => {
  expect(computeRec(NOW, NOW)).toBe(1)
})

test('computeRec: 28 days old ≈ e^-2', () => {
  expect(computeRec(NOW - 28 * DAY_MS, NOW)).toBeCloseTo(Math.exp(-2), 10)
})

test('computeRec: 14-day decay horizon hits e^-1', () => {
  expect(computeRec(NOW - 14 * DAY_MS, NOW)).toBeCloseTo(Math.exp(-1), 10)
})

test('computeRec: future lastVisit (clock skew) clamps to 1', () => {
  expect(computeRec(NOW + 5 * DAY_MS, NOW)).toBe(1)
})

test('blend: clamp engages — frecency contributes at most (1 + B)', () => {
  const cap = 1 + 1.0
  expect(blend(1.0, 10, 1)).toBe(2)
  expect(blend(1.0, 10, 1)).toBeCloseTo(cap, 10)
})

test('blend: weak match with huge frecency stays weak', () => {
  // fzf still owns ordering between candidates (the clamp guarantee)
  expect(blend(0.1, 10, 1)).toBeCloseTo(0.2, 10)
})

test('blend: moderate frecency below the cap is uncapped', () => {
  // freq = ln(4) ≈ 1.386, rec = 1 → frecency 2.386 → capped; but force
  // a sub-cap case: freq(3,0)=ln(4)=1.386... use freq=0.5, rec=0.25
  expect(blend(0.8, 0.5, 0.25)).toBeCloseTo(0.8 * 1.75, 10)
})

test('blend monotonicity in visitCount', () => {
  const lo = blend(1, computeFreq(5, 0), 1)
  const hi = blend(1, computeFreq(50, 0), 1)
  expect(hi).toBeGreaterThanOrEqual(lo)
})

test('frecencyScore: recent+typed outranks equally-counted older page', () => {
  const fresh: PageRecord = mk({
    visitCount: 5,
    typedCount: 2,
    lastVisit: NOW - DAY_MS,
  })
  const older: PageRecord = mk({
    visitCount: 5,
    typedCount: 2,
    lastVisit: NOW - 30 * DAY_MS,
  })
  expect(frecencyScore(fresh, NOW)).toBeGreaterThan(
    frecencyScore(older, NOW),
  )
})

test('frecencyScore: pure frecency is UNCLAMPED by design (landing list)', () => {
  // The landing list is "your habits" — a stone-cold but massively
  // visited page legitimately floats to the top. The FRECENCY_CAP
  // clamp applies only to `blend` (among real matches) — pinning
  // this difference so nobody "fixes" it later.
  const ancient: PageRecord = mk({
    visitCount: 500,
    typedCount: 0,
    lastVisit: NOW - 400 * DAY_MS,
  })
  const fresh: PageRecord = mk({
    visitCount: 5,
    typedCount: 2,
    lastVisit: NOW - DAY_MS,
  })
  expect(frecencyScore(ancient, NOW)).toBeGreaterThan(
    frecencyScore(fresh, NOW),
  )
})

function mk(p: Partial<PageRecord>): PageRecord {
  return {
    url: 'https://example.com/x',
    rawUrl: 'https://example.com/x',
    title: 'X',
    host: 'example.com',
    visitCount: 1,
    typedCount: 0,
    firstVisit: NOW,
    lastVisit: NOW,
    ...p,
  }
}
