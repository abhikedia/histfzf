import { OMNIBOX_COUNT } from './constants'
import { buildSearchRecords, landingList } from './indexmodel'
import { createFzf, search } from './overlay/search'
import type { PageRecord, SearchRecord } from './types'

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
}

/** Chrome parses its omnibox markup — literal `<`/`>`/`&` in page titles
 * or URLs would break the suggestion rendering. Escape before wrapping. */
function escapeMarkup(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function toOmniboxEntry(record: SearchRecord): OmniboxEntry {
  const url = escapeMarkup(record.rawUrl)
  const title = escapeMarkup(record.title)
  return {
    content: record.rawUrl,
    description: title ? `<dim>${title}</dim> <match>${url}</match>` : `<match>${url}</match>`,
  }
}

/**
 * The suggestion list for one omnibox query:
 *   empty query → the same pure-frecency landing list as the palette
 *   otherwise   → the fzf + bounded frecency blend, cut to OMNIBOX_COUNT
 */
export function buildSuggestions(
  pageRecords: PageRecord[],
  query: string,
  nowMs: number,
): OmniboxEntry[] {
  const records = buildSearchRecords(pageRecords)
  if (query === '') {
    return landingList(records, nowMs, OMNIBOX_COUNT).map(toOmniboxEntry)
  }
  // The omnibox is stateless per keystroke: a fresh pass over the full
  // index (no narrowing session), cut to the address-bar row limit.
  const { rows } = search(createFzf(records), { query: '', pool: null }, query, nowMs)
  // The engine already cut to RENDER_CAP; the address bar shows fewer.
  return rows.slice(0, OMNIBOX_COUNT).map((row) => toOmniboxEntry(row.record))
}
