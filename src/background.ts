import contentScriptPath from './content?script'
import { MSG } from './constants'
import * as db from './db'
import type { IndexResponse } from './types'

const RestrictedPrefixes = ['chrome:', 'chrome-extension:']

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-palette') {
    return
  }
  try {
    // Prefer the tab Chrome hands us; fall back to a query.
    const target =
      tab?.id != null ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!target?.id) {
      return
    }
    if (target.url && RestrictedPrefixes.some((p) => target.url!.startsWith(p))) {
      // Privileged pages can't be injected into — silent no-op for MVP.
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

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
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
  // No async response needed for other messages.
  return false
})
