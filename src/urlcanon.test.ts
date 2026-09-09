import { test, expect } from 'vitest'
import { canonicalize } from './urlcanon'

type Case = {
  name: string
  input: string
  expected: string | null
}

const cases: Case[] = [
  {
    name: 'plain url unchanged (1)',
    input: 'https://github.com/pulls',
    expected: 'https://github.com/pulls',
  },
  {
    name: 'trailing slash stripped (2)',
    input: 'https://github.com/pulls/',
    expected: 'https://github.com/pulls',
  },
  {
    name: 'http collapsed to https (3)',
    input: 'http://github.com/pulls',
    expected: 'https://github.com/pulls',
  },
  {
    name: 'host lowercased, path case preserved (4)',
    input: 'https://GitHub.com/Pulls',
    expected: 'https://github.com/Pulls',
  },
  {
    name: 'utm param stripped (5)',
    input: 'https://github.com/pulls?utm_source=x',
    expected: 'https://github.com/pulls',
  },
  {
    name: 'params sorted by key then value (6)',
    input: 'https://a.com/?b=2&a=1',
    expected: 'https://a.com/?a=1&b=2',
  },
  {
    name: 'anchor fragment stripped (7)',
    input: 'https://a.com/x#section',
    expected: 'https://a.com/x',
  },
  {
    name: 'spa hash route kept (8)',
    input: 'https://a.com/#/inbox',
    expected: 'https://a.com/#/inbox',
  },
  {
    name: 'hashbang route kept (9)',
    input: 'https://a.com/#!/settings',
    expected: 'https://a.com/#!/settings',
  },
  {
    name: 'bare domain gets root slash (10)',
    input: 'https://a.com',
    expected: 'https://a.com/',
  },
  {
    name: 'ref stripped, useful params kept (11)',
    input: 'https://a.com/?ref=twitter&q=foo',
    expected: 'https://a.com/?q=foo',
  },
  {
    name: 'custom port kept (12)',
    input: 'https://a.com:8080/x',
    expected: 'https://a.com:8080/x',
  },
  {
    name: 'default port dropped (13)',
    input: 'https://a.com:443/x',
    expected: 'https://a.com/x',
  },
  {
    name: 'chrome:// rejected (14)',
    input: 'chrome://extensions',
    expected: null,
  },
  {
    name: 'about: rejected (15)',
    input: 'about:blank',
    expected: null,
  },
  {
    name: 'file:// rejected (16)',
    input: 'file:///Users/x/doc.pdf',
    expected: null,
  },
  {
    name: 'garbage input rejected (17)',
    input: 'not a url',
    expected: null,
  },
  {
    name: 'same-key params keep relative order (18)',
    input: 'https://a.com/x?a=1&a=2',
    expected: 'https://a.com/x?a=1&a=2',
  },
  {
    name: 'fbclid stripped (19)',
    input: 'https://a.com/x?fbclid=zzz',
    expected: 'https://a.com/x',
  },
  {
    name: 'bare # is not a spa route (20)',
    input: 'https://a.com/x#',
    expected: 'https://a.com/x',
  },
]

for (const c of cases) {
  test(c.name, () => {
    expect(canonicalize(c.input)).toBe(c.expected)
  })
}

test('pure determinism: same input, same key', () => {
  expect(canonicalize('https://a.com/x?b=1&a=1')).toBe(
    canonicalize('https://a.com/x?a=1&b=1'),
  )
})
