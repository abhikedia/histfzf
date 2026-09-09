const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
])

/**
 * Collapses URL variants into one canonical dedupe key.
 * Returns null for anything that is not a real http(s) page — the caller
 * must skip those records entirely. The key is LOSSY and must never be
 * navigated to; store the original URL separately as `rawUrl`.
 */
export function canonicalize(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }

  // Rule 2: scheme — collapse http to https.
  url.protocol = 'https:'
  // Rule 1: host lowercase. url.origin already lowercases the host and
  // drops default ports (:80/:443) while keeping custom ones (:8080).
  const origin = url.origin

  // Rule 4: fragment — keep only SPA routes (#/ or #!), drop anchors.
  const hash =
    url.hash.startsWith('#/') || url.hash.startsWith('#!') ? url.hash : ''

  // Rule 5: strip tracking params, sort the survivors (key then value).
  const entries = Array.from(url.searchParams.entries())
    .filter(([key]) => !TRACKING_PARAMS.has(key))
    .sort(([aKey, aVal], [bKey, bVal]) =>
      aKey === bKey ? (aVal < bVal ? -1 : 1) : aKey < bKey ? -1 : 1,
    )
  const query = new URLSearchParams(entries).toString()

  // Rule 3: trailing slash stripped, except the domain root.
  let path = url.pathname
  if (path === '') {
    path = '/'
  } else if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }

  let key = `${origin}${path}`
  if (query) {
    key += `?${query}`
  }
  key += hash
  return key
}
