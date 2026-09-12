/**
 * The chrome mock harness: installs a fake `globalThis.chrome` whose
 * events are captured as invokable listeners and whose side effects
 * (tab operations, scripting injection) are recorded as a call log.
 * Used by background.test.ts and content.test.ts — the wiring tests.
 *
 * Import this BEFORE the module under test, since entry files attach
 * listeners at module scope.
 */

export interface ChromeHarness {
  /** Event listeners registered by the modules under test, by name. */
  listeners: {
    onInstalled: Array<(details: { reason: string }) => void>
    onCommand: Array<(command: string, tab?: { id: number; url?: string }) => void>
    onVisited: Array<(item: unknown) => void>
    onUpdated: Array<(tabId: number, changeInfo: { title?: string }, tab?: { url?: string }) => void>
    onMessage: Array<(req: unknown, sender: unknown, sendResponse: (resp: unknown) => void) => boolean | void>
    onInputStarted: Array<() => void>
    onInputChanged: Array<(text: string, suggest: (suggestions: Array<{ content: string; description: string }>) => void) => void>
    onInputEntered: Array<(text: string, disposition: string) => void>
  }
  /** In-memory chrome.storage.local. */
  store: Map<string, unknown>
  /** Queue consumed one entry per chrome.history.search call (empty
   * entries yield []); lets tests script seed walks through the real
   * chrome bridge. */
  historyQueue: unknown[][]
  /** Every recorded side effect (tabs.*, scripting.*, runtime.*). */
  callLog: Array<{ kind: string; args: unknown }>
  /** Fake tab pool used by tabs.create/remove/query. */
  tabs: Map<number, { id: number; url?: string }>
  /** The default tab handed to onCommand when the test wants one. */
  activeTab: { id: number; url?: string }
  /** Reset side effects without dropping listener registrations. */
  reset(): void
}

export function installChromeMock(): ChromeHarness {
  const listeners = {
    onInstalled: [] as ChromeHarness['listeners']['onInstalled'],
    onCommand: [] as ChromeHarness['listeners']['onCommand'],
    onVisited: [] as ChromeHarness['listeners']['onVisited'],
    onUpdated: [] as ChromeHarness['listeners']['onUpdated'],
    onMessage: [] as ChromeHarness['listeners']['onMessage'],
    onInputStarted: [] as ChromeHarness['listeners']['onInputStarted'],
    onInputChanged: [] as ChromeHarness['listeners']['onInputChanged'],
    onInputEntered: [] as ChromeHarness['listeners']['onInputEntered'],
  }
  const store = new Map<string, unknown>()
  const callLog: ChromeHarness['callLog'] = []
  const historyQueue: unknown[][] = []
  const tabs = new Map<number, { id: number; url?: string }>()
  let nextTabId = 100
  const activeTab = { id: 7, url: 'https://news.example/article' }
  tabs.set(7, activeTab)

  function log(kind: string, args: unknown): void {
    callLog.push({ kind, args })
  }

  const chromeMock = {
    runtime: {
      id: 'test',
      getURL(path = ''): string {
        return `chrome-extension://test/${path}`
      },
      async sendMessage(msg: unknown): Promise<unknown> {
        log('runtime.sendMessage', msg)
        return undefined
      },
      onMessage: {
        addListener(cb: ChromeHarness['listeners']['onMessage'][number]) {
          listeners.onMessage.push(cb)
        },
      },
      onInstalled: {
        addListener(cb: ChromeHarness['listeners']['onInstalled'][number]) {
          listeners.onInstalled.push(cb)
        },
      },
    },
    commands: {
      onCommand: {
        addListener(cb: ChromeHarness['listeners']['onCommand'][number]) {
          listeners.onCommand.push(cb)
        },
      },
    },
    omnibox: {
      onInputStarted: {
        addListener(cb: () => void) {
          listeners.onInputStarted.push(cb)
        },
      },
      onInputChanged: {
        addListener(
          cb: (text: string, suggest: (suggestions: Array<{ content: string; description: string }>) => void) => void,
        ) {
          listeners.onInputChanged.push(cb)
        },
      },
      onInputEntered: {
        addListener(
          cb: (text: string, disposition: string) => void,
        ) {
          listeners.onInputEntered.push(cb)
        },
      },
    },
    history: {
      onVisited: {
        addListener(cb: ChromeHarness['listeners']['onVisited'][number]) {
          listeners.onVisited.push(cb)
        },
      },
    async search(query: { startTime?: number; endTime?: number }): Promise<unknown[]> {
      log('history.search', query)
      return historyQueue.shift() ?? []
    },
    },
    tabs: {
      onUpdated: {
        addListener(cb: ChromeHarness['listeners']['onUpdated'][number]) {
          listeners.onUpdated.push(cb)
        },
      },
      create(options: { url?: string }): Promise<{ id: number }> {
        log('tabs.create', options)
        const tab = { id: nextTabId++, url: options.url }
        tabs.set(tab.id, tab)
        return Promise.resolve(tab)
      },
      update(tabId: number, options: { url?: string }): Promise<unknown> {
        log('tabs.update', { tabId, ...options })
        const tab = tabs.get(tabId)
        if (tab && options.url) {
          tab.url = options.url
        }
        return Promise.resolve(undefined)
      },
      remove(tabId: number): Promise<void> {
        log('tabs.remove', tabId)
        tabs.delete(tabId)
        return Promise.resolve()
      },
      query(_info: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id: number; url?: string }>> {
        log('tabs.query', _info)
        return Promise.resolve([activeTab])
      },
    },
    scripting: {
      executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown> {
        log('scripting.executeScript', options)
        return Promise.resolve([])
      },
    },
    storage: {
      local: {
        async get(keys: Array<string> | null): Promise<Record<string, unknown>> {
          if (keys === null) {
            return Object.fromEntries(store)
          }
          const out: Record<string, unknown> = {}
          for (const key of keys) {
            if (store.has(key)) {
              out[key] = store.get(key)
            }
          }
          return out
        },
        async set(patch: Record<string, unknown>): Promise<void> {
          log('storage.local.set', patch)
          for (const [k, v] of Object.entries(patch ?? {})) {
            store.set(k, v)
          }
        },
        async remove(key: string | string[]): Promise<void> {
          for (const k of Array.isArray(key) ? key : [key]) {
            store.delete(k)
          }
        },
      },
    },
  }

  ;(globalThis as unknown as { chrome?: unknown }).chrome = chromeMock

  return {
    listeners,
    store,
    callLog,
    historyQueue,
    tabs,
    activeTab,
    reset() {
      callLog.length = 0
      historyQueue.length = 0
      activeTab.id = 7
      activeTab.url = 'https://news.example/article'
      tabs.clear()
      tabs.set(activeTab.id, activeTab)
      store.clear()
    },
  }
}
