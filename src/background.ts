import contentScriptPath from './content?script'
import { MSG } from './constants'
import * as db from './db'
import type { IndexResponse } from './types'

const RestrictedPrefixes = ['chrome:', 'chrome-extension:']

// Option C (disposable tab takeover): on restricted pages the palette
// opens as its OWN tab (chrome.tabs.create). Why not replace the page
// in the same tab (chrome.tabs.update)? No research shortcuts there —
// a page-side focus() call cannot steal attention from the omnibox,
// which chrome-side focus retention keeps on permanent duty for
// programmatic tab navigations. tabs.create is an ordinary navigation:
// the palette page receives focus naturally, like every other site.
// Dismissal (Esc / scrim / toggle) removes the tab; Chrome
// auto-activates the tab one was just on — the "original page" for
// free, no session stash needed.
const PALETTE_URL = chrome.runtime.getURL('src/overlay/index.html')
const OVERLAY_TAB_URL = `${PALETTE_URL}?mode=tab`

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
    const tabId = target.id

    if (url === OVERLAY_TAB_URL) {
      // The palette owns this tab — the shortcut toggles it closed;
      // removing it makes Chrome focus the tab that was just there.
      await chrome.tabs.remove(tabId)
      return
    }

    const restricted =
      RestrictedPrefixes.some((p) => url.startsWith(p)) || url === ''

    if (restricted) {
      // Disposable palette tab. True same-tab replacement was rejected
      // (see above) — chrome.tabs.create avoids the omnibox focus trap
      // entirely, and remove() is a well-defined "go back".
      await chrome.tabs.create({ url: OVERLAY_TAB_URL })
      return
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScriptPath],
    })
  } catch (err) {
    console.error('[histfzf] injection failed', err)
  }
})

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req?.type === MSG.GET_INDEX) {
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
  if (req?.type === MSG.OPEN_NEW_TAB) {
    chrome.tabs.create({ url: req.url }).catch((err) => {
      console.error('[histfzf] OPEN_NEW_TAB failed', err)
    })
  }
  if (req?.type === MSG.RESTORE_TAB) {
    // Dismiss the disposable takeover tab (sender.tab exists only when
    // the palette truly owns a top-level tab; popups/iframes are not).
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
