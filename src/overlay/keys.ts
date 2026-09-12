/**
 * Keyboard model (§11): arrows / Ctrl-n / Ctrl-p move, Enter opens in
 * the same tab, Shift/Cmd/Ctrl+Enter opens a new tab. Selection stops
 * at the ends — never wraps (fzf behavior).
 */

type PaletteKeyAction = 'open' | 'new-tab' | 'next' | 'prev'

export function keyToAction(event: {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
}): PaletteKeyAction | null {
  const { key, shiftKey = false, metaKey = false, ctrlKey = false } = event
  if (key === 'Enter') {
    return shiftKey || metaKey || ctrlKey ? 'new-tab' : 'open'
  }
  if (key === 'ArrowDown' || (key === 'n' && ctrlKey)) {
    return 'next'
  }
  if (key === 'ArrowUp' || (key === 'p' && ctrlKey)) {
    return 'prev'
  }
  return null
}

/** Clamped, non-wrapping selection move: callers past the ends are
 * no-ops (stay at the current edge). Callers only act when rows
 * exist — an empty list always yields 0. */
export function moveSelection(
  index: number,
  length: number,
  delta: number,
): number {
  const next = index + delta
  if (length <= 0) {
    return 0
  }
  if (next < 0) {
    return 0
  }
  if (next > length - 1) {
    return length - 1
  }
  return next
}
