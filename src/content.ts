import { IFRAME_ID, MSG } from './constants'
import type { OverlayMessage } from './types'

// Injected on demand: mounts/toggles the overlay iframe and relays
// postMessages between the overlay (extension origin) and this page.
// Computes the extension origin once — message validation depends on it.
// Note: in a browser, chrome-extension:// parses as a standard scheme so
// url.origin is the real origin; Node/jsdom URL implementations return
// the string "null" for non-special schemes, hence the fallback that
// derives the origin from the raw URL.
function extensionOrigin(): string {
  const raw = chrome.runtime.getURL('')
  const parsed = new URL(raw)
  return parsed.origin === 'null' ? raw.replace(/\/$/, '') : parsed.origin
}
const EXTENSION_ORIGIN = extensionOrigin()

type ExtWindow = Window & {
  __histFzfOpen?: boolean
  __histFzfRelay?: (event: MessageEvent) => void
}

function isOpen(): boolean {
  return (window as ExtWindow).__histFzfOpen !== false
}

function setOpen(value: boolean): void {
  ;(window as ExtWindow).__histFzfOpen = value
}

function show(iframe: HTMLIFrameElement, { announce = true }: { announce?: boolean } = {}) {
  iframe.style.display = 'block'
  // Steer keyboard focus into the iframe chrome itself; the overlay
  // focuses its input on mount/SHOW.
  iframe.focus()
  if (announce) {
    try {
      iframe.contentWindow?.postMessage({ type: MSG.SHOW }, EXTENSION_ORIGIN)
    } catch {
      // SHOW is a focus nicety — an origin/target delivery failure must
      // never break mount/toggle. The overlay also self-focuses.
    }
  }
}

function hide(iframe: HTMLIFrameElement): void {
  iframe.style.display = 'none'
}

function createIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.id = IFRAME_ID
  iframe.src = chrome.runtime.getURL('src/overlay/index.html')
  Object.assign(iframe.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    border: '0',
    zIndex: '2147483647',
    background: 'transparent',
    display: 'block',
  } as CSSStyleDeclaration)
  return iframe
}

function main() {
  const existing = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null

  if (!existing) {
    const iframe = createIframe()
    document.documentElement.appendChild(iframe)
    setOpen(true)
    show(iframe)
    // Safety net: the very first SHOW can race React's mount —
    // re-announce once the page is truly listening.
    iframe.addEventListener('load', () => {
      if (isOpen()) {
        show(iframe)
      }
    })
    ensureRelay(iframe)
    return
  }

  // survived an extension reload (isolated world reset, iframe kept) —
  // rebind the relay to the frame that's actually in the DOM.
  ensureRelay(existing)

  if (isOpen()) {
    hide(existing)
    setOpen(false)
  } else {
    show(existing)
    setOpen(true)
  }
}

/** One relay per isolated world, bound to the LIVE frame. Re-binding on
 * every injection covers the extension-reload case: the old world's
 * listener dies with it, the fresh injection must own the messages. */
function ensureRelay(iframe: HTMLIFrameElement): void {
  const extWindow = window as ExtWindow
  if (extWindow.__histFzfRelay) {
    window.removeEventListener('message', extWindow.__histFzfRelay as EventListener)
  }
  const relay = onOverlayMessage(iframe)
  window.addEventListener('message', relay)
  extWindow.__histFzfRelay = relay
}

function onOverlayMessage(iframe: HTMLIFrameElement) {
  // Relay: overlay → page. Accept ONLY extension-origin messages —
  // a hostile page could otherwise trigger navigation/close through us.
  return (event: MessageEvent<OverlayMessage>) => {
    if (event.origin !== EXTENSION_ORIGIN) {
      return
    }
    const msg = event.data
    if (!msg?.type) {
      return
    }
    if (msg.type === MSG.NAVIGATE) {
      if (msg.newTab) {
        chrome.runtime
          .sendMessage({ type: MSG.OPEN_NEW_TAB, url: msg.url })
          .catch((err) => console.error('[histfzf] open new tab failed', err))
      } else {
        location.assign(msg.url)
      }
    } else if (msg.type === MSG.CLOSE) {
      hide(iframe)
      setOpen(false)
    }
  }
}

// Injection entrypoint. CRXJS's loader dynamic-imports this module and
// calls onExecute() on EVERY executeScript — top-level code would run
// only once per realm (ESM cache), so every toggle after the first
// would silently do nothing. All per-injection work lives here.
export function onExecute() {
  main()
}
