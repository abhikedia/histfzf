import contentScriptPath from './content?script'
import { MSG, SEED_DONE_KEY, SEED_MAX_RESULTS, SEED_WM_KEY } from './constants'
import * as db from './db'
import { canonicalize } from './urlcanon'
import { runSeed, type SeedDeps } from './seed'
import { buildSearchRecords } from './indexmodel'
import { buildSuggestions } from './omnibox'
import { isSWRequest, type SWRequest, type SearchRecord } from './types'
import type { IndexResponse } from './types'

const RestrictedPrefixes = ['chrome:', 'chrome-extension:']

// The disposable palette-tab fallback for restricted pages.
const PALETTE_URL = chrome.runtime.getURL('src/overlay/index.html')
const OVERLAY_TAB_URL = `${PALETTE_URL}?mode=tab`

// ---------------------------------------------------------------------------
// Seeding — chrome-backed wiring for the seed engine (src/seed.ts).
// The walk/resume/stop ALGORITHM lives in seed.ts behind injected deps,
// which is exactly what makes it unit-testable; this file only bridges
// it to chrome.*.
// ---------------------------------------------------------------------------

const seedDeps: SeedDeps = {
  async readState() {
    const stored = await chrome.storage.local.get([SEED_DONE_KEY, SEED_WM_KEY])
    return {
      done: stored[SEED_DONE_KEY] === true,
      watermark: typeof stored[SEED_WM_KEY] === 'number' ? (stored[SEED_WM_KEY] as number) : undefined,
    }
  },
  async writeState(patch) {
    await chrome.storage.local.set(patch)
  },
  async clearWatermark() {
    await chrome.storage.local.remove(SEED_WM_KEY)
  },
  searchHistory(range) {
    return chrome.history.search({
      text: '',
      startTime: range.startTime,
      endTime: range.endTime,
      maxResults: SEED_MAX_RESULTS,
    })
  },
  now() {
    return Date.now()
  },
}

function resumeSeedIfPending(): void {
  chrome.storage.local
    .get([SEED_DONE_KEY, SEED_WM_KEY])
    .then((stored) => {
      if (!stored[SEED_DONE_KEY] && stored[SEED_WM_KEY] != null) {
        void runSeed(seedDeps).catch((err) => {
          console.error('[histfzf] seed failed (resumes on next wake)', err)
        })
      }
    })
    .catch((err) => console.error('[histfzf] seed resume check failed', err))
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void runSeed(seedDeps).catch((err) => {
      console.error('[histfzf] seed failed (resumes on next wake)', err)
    })
  }
})

// SW wake from any event — continues an interrupted seed.
resumeSeedIfPending()

// ---------------------------------------------------------------------------
// Live capture (counts arrive separately from titles)
// ---------------------------------------------------------------------------

// Counts: visitCount/typedCount/lastVisit arrive here. NEVER trust its
// title — it is empty on first-ever visits (the event fires at
// navigation-commit, before the HTML <title> has been parsed).
chrome.history.onVisited.addListener((item) => {
  if (!item.url) {
    return
  }
  const key = canonicalize(item.url)
  if (key === null) {
    return
  }
  db.recordVisit(
    key,
    item.url,
    item.lastVisitTime ?? Date.now(),
    (item.typedCount ?? 0) > 0,
  ).catch((err) => console.error('[histfzf] visit capture failed', err))
})

// Titles: the real title ONLY arrives via tabs.onUpdated
// changeInfo.title — potentially more than once per navigation, and the
// updateTitle triple-guard absorbs the redundancy. tab.url needs
// the tabs permission.
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  try {
    const title = changeInfo.title
    if (title === undefined || !tab?.url) {
      return
    }
    const key = canonicalize(tab.url)
    if (key === null) {
      return
    }
    await db.updateTitle(key, title)
  } catch (err) {
    console.error('[histfzf] title capture failed', err)
  }
})

// ---------------------------------------------------------------------------
// Command path + messages (shortcut → inject/toggle, index/tab requests)
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-palette') {
    return
  }
  try {
    // Prefer the tab Chrome hands us; fall back to a query.
    const target =
      tab?.id != null
        ? tab
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!target?.id) {
      return
    }
    const url = target.url ?? ''

    if (url === OVERLAY_TAB_URL) {
      // The palette is already this tab — the shortcut toggles it
      // closed; removing it re-activates the tab that was there.
      await chrome.tabs.remove(target.id)
      return
    }

    const restricted =
      RestrictedPrefixes.some((p) => url.startsWith(p)) || url === ''

    if (restricted) {
      // Disposable palette tab fallback.
      await chrome.tabs.create({ url: OVERLAY_TAB_URL })
      return
    }

    await chrome.scripting.executeScript({
      target: { tabId: target.id },
      files: [contentScriptPath],
    })
  } catch (err) {
    console.error('[histfzf] injection failed', err)
  }
})

chrome.runtime.onMessage.addListener((rawRequest, sender, sendResponse) => {
  // The type guard narrows to exactly the three SWRequest variants and
  // drops everything else (hostile senders, malformed payloads).
  if (!isSWRequest(rawRequest)) {
    return false
  }
  const request: SWRequest = rawRequest
  if (request.type === MSG.GET_INDEX) {
    db.getAll()
      .then((records) => {
        const response: IndexResponse = { records }
        sendResponse(response)
      })
      .catch((err) => {
        console.error('[histfzf] GET_INDEX failed', err)
        sendResponse({ records: [] })
      })
    // Keep the message channel open for the async sendResponse.
    return true
  }
  if (request.type === MSG.OPEN_NEW_TAB) {
    chrome.tabs.create({ url: request.url }).catch((err) => {
      console.error('[histfzf] OPEN_NEW_TAB failed', err)
    })
    return false
  }
  if (request.type === MSG.RESTORE_TAB) {
    // Dismiss the disposable takeover tab.
    const tabId = sender.tab?.id
    if (tabId != null) {
      chrome.tabs.remove(tabId).catch((err) => {
        console.error('[histfzf] RESTORE_TAB failed', err)
      })
    }
  }
  // No async response needed for other messages.
  return false
})

// ---------------------------------------------------------------------------
// Omnibox keyword (`h` + Space in the address bar)
//
// Reuses the palette pipeline verbatim (indexmodel + fzf + frecency via
// omnibox.ts). The index cache lives for exactly ONE worker lifetime
// (module scope, never persisted): built lazily on the first omnibox
// event of a wake session, lost when the SW dies, rebuilt next session.
// That is the correct ephemeral shape — disk stays the single source of
// truth, and a session can never outlive its staleness by more than
// the minutes a query session lasts.
// ---------------------------------------------------------------------------

let omniboxSession: SearchRecord[] | null = null

async function omniboxRecords(): Promise<SearchRecord[]> {
  omniboxSession ??= buildSearchRecords(await db.getAll())
  return omniboxSession
}

chrome.omnibox.onInputStarted.addListener(() => {
  void omniboxRecords().catch((err) => {
    console.error('[histfzf] omnibox index load failed', err)
  })
})

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  omniboxRecords()
    .then((records) => {
      suggest(buildSuggestions(records, text, Date.now()))
    })
    .catch((err) => {
      console.error('[histfzf] omnibox suggest failed', err)
      suggest([])
    })
})

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  // A suggestion's content is the payload (the rawUrl). Anything that
  // is not an http(s) URL (e.g. the user typed plain words) is ignored.
  let url: URL | null = null
  try {
    url = new URL(text)
  } catch {
    url = null
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return
  }
  if (disposition === 'newForegroundTab') {
    await chrome.tabs.create({ url: text, active: true })
    return
  }
  if (disposition === 'newBackgroundTab') {
    await chrome.tabs.create({ url: text, active: false })
    return
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { url: text })
  }
})
