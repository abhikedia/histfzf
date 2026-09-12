import { test, expect } from 'vitest'
import { keyToAction, moveSelection } from './keys'

test('Enter opens in the same tab', () => {
  expect(keyToAction({ key: 'Enter' })).toBe('open')
})

test.each([
  [{ key: 'Enter', shiftKey: true }],
  [{ key: 'Enter', metaKey: true }],
  [{ key: 'Enter', ctrlKey: true }],
])('modifier+Enter opens a new tab: %j', (event) => {
  expect(keyToAction(event)).toBe('new-tab')
})

test('arrows and Ctrl-n/p move selection', () => {
  expect(keyToAction({ key: 'ArrowDown' })).toBe('next')
  expect(keyToAction({ key: 'ArrowUp' })).toBe('prev')
  expect(keyToAction({ key: 'n', ctrlKey: true })).toBe('next')
  expect(keyToAction({ key: 'p', ctrlKey: true })).toBe('prev')
})

test('bare letters or Meta-n never move selection', () => {
  expect(keyToAction({ key: 'n' })).toBeNull()
  expect(keyToAction({ key: 'p' })).toBeNull()
  expect(keyToAction({ key: 'n', metaKey: true })).toBeNull()
  expect(keyToAction({ key: 'x' })).toBeNull()
})

test('moveSelection clamps at both ends — no wrap', () => {
  expect(moveSelection(0, 5, -1)).toBe(0)
  expect(moveSelection(0, 5, +1)).toBe(1)
  expect(moveSelection(4, 5, +1)).toBe(4)
  expect(moveSelection(2, 5, +1)).toBe(3)
  expect(moveSelection(4, 5, -1)).toBe(3)
})

test('moveSelection edges: empty list yields 0, single item stays', () => {
  expect(moveSelection(0, 0, +1)).toBe(0)
  expect(moveSelection(0, 1, +1)).toBe(0)
  expect(moveSelection(0, 1, -1)).toBe(0)
})
