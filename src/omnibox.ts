import { OMNIBOX_COUNT } from './constants'
import { landingList } from './indexmodel'
import { createFzf, search } from './overlay/search'
import type { SearchRecord } from './types'

/**
 * The omnibox keyword entry point (Chrome address bar): `h` + Space.
 * Reuses the exact same pipeline as the palette — the in-memory model,
 * fzf pass, bounded frecency blend — through the framework-free
 * modules; only the presentation differs (Chrome's own <match>/<dim>
 * markup, ~N rows, no character-level highlighting).
 */

export interface OmniboxEntry {
  /** The navigable payload for onInputEntered — always the rawUrl, never
   * the lossy canonical key. */
  content: string
  /** Coarse Chrome markup: dimmed title, matched URL. */
  description: string
  /** Leading-edge row icon (nodoc API field, cast at the suggest
   * boundary): the same _favicon service the palette uses, at dropdown
   * size. Without it, Chrome's per-row icon behavior is inconsistent
   * (icons on some rows, extension-icon fallbacks on others). */
  iconUrl?: string
}

/** Chrome parses its omnibox markup — literal `<`/`>`/`&` in page titles
 * or URLs would break the suggestion rendering. Escape before wrapping. */
function escapeMarkup(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Guarded because the engine is also exercised outside the extension
 * runtime (unit tests): no chrome namespace → no icon URL. */
function faviconIconUrl(rawUrl: string): string | undefined {
  try {
    return chrome.runtime.getURL(
      `_favicon/?pageUrl=${encodeURIComponent(rawUrl)}&size=16`,
    )
  } catch {
    return undefined
  }
}

export function toOmniboxEntry(record: SearchRecord): OmniboxEntry {
  const url = escapeMarkup(record.rawUrl)
  const title = escapeMarkup(record.title)
  return {
    content: record.rawUrl,
    description: title ? `<dim>${title}</dim> <match>${url}</match>` : `<match>${url}</match>`,
    iconUrl: faviconIconUrl(record.rawUrl),
  }
}

/**
 * The suggestion list for one omnibox query. Records arrive as the
 * prebuilt SearchRecord[] (the SW session cache — built once per
 * worker lifetime, never per keystroke):
 *   empty query → the same pure-frecency list as the palette
 *   otherwise   → the fzf + bounded frecency blend, cut to OMNIBOX_COUNT
 */
export function buildSuggestions(
  records: SearchRecord[],
  query: string,
  nowMs: number,
): OmniboxEntry[] {
  if (query === '') {
    return landingList(records, nowMs, OMNIBOX_COUNT).map(toOmniboxEntry)
  }
  // The omnibox is stateless per keystroke: a fresh pass over the full
  // index (no narrowing session), cut to the address-bar row limit.
  const { rows } = search(createFzf(records), { query: '', pool: null }, query, nowMs)
  // The engine already cut to RENDER_CAP; the address bar shows fewer.
  return rows.slice(0, OMNIBOX_COUNT).map((row) => toOmniboxEntry(row.record))
}
