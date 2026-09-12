import { IFRAME_ID, MSG } from './constants'
import type { OverlayMessage } from './types'

// Injected on demand: mounts/toggles the overlay iframe and relays
// postMessages between the overlay (extension origin) and this page.
// Computes the extension origin once — message validation depends on it.
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin

type ExtWindow = Window & { __histFzfOpen?: boolean }

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
    iframe.contentWindow?.postMessage({ type: MSG.SHOW }, EXTENSION_ORIGIN)
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
    window.addEventListener('message', onOverlayMessage(iframe))
    return
  }

  if (isOpen()) {
    hide(existing)
    setOpen(false)
  } else {
    show(existing)
    setOpen(true)
  }
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
