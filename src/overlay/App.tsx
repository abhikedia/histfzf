import { useEffect, useRef } from 'react'
import { MSG } from '../constants'

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  // Deployment mode: 'mode=tab' = same-tab takeover (option C) — the
  // palette page IS the tab, no parent iframe exists.
  const TAKEOVER = new URLSearchParams(location.search).get('mode') === 'tab'

  useEffect(() => {
    let cancelled = false
    chrome.runtime
      .sendMessage({ type: MSG.GET_INDEX })
      .then((res) => {
        if (cancelled) {
          return
        }
        // Success IS the round-trip proof itself — an extension-origin
        // iframe reaching the SW through a message port is the whole
        // storage-partitioning question answered. Logging every index
        // load would be console noise; the search commits use the
        // record array directly.
        void res
      })
      .catch((err) => {
        console.error('[histfzf] GET_INDEX failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Esc closes from ANYWHERE (not only while the input holds focus).
    // What "close" means differs per mode — see close() below.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    // TAKEOVER focus: tabs.create navigations deliver focus to the
    // page like ordinary link navigations, but claim it directly as
    // well (the tabs.create focus race) and whenever the window
    // regains focus.
    if (!TAKEOVER) {
      return
    }
    const focusInput = () => {
      inputRef.current?.focus()
    }
    const timers = [0, 60].map((delay) => setTimeout(focusInput, delay))
    window.addEventListener('focus', focusInput)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('focus', focusInput)
    }
  }, [])

  useEffect(() => {
    // SHOW → the palette just became visible (mount OR re-show after
    // toggle). Focus the input and select its text so reopening is a
    // "type over" gesture. The message comes from our own isolated
    // content script (parent side); a forged SHOW from a hostile page
    // is harmless (focus only), so no strict origin dance needed.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return
      }
      if (event.data?.type === MSG.SHOW) {
        const input = inputRef.current
        if (!input) {
          return
        }
        input.focus()
        input.select()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Close means different things per deployment mode:
  // - iframe (normal pages): relay CLOSE to the content script
  // - mode=tab (same-tab takeover, option C): ask the SW to restore
  //   the page this tab was before the palette took it over
  function close() {
    if (TAKEOVER) {
      chrome.runtime
        .sendMessage({ type: MSG.RESTORE_TAB })
        .catch((err) => console.error('[histfzf] restore failed', err))
      return
    }
    window.parent.postMessage({ type: MSG.CLOSE }, '*')
  }

  return (
    <div className="hf-scrim" onClick={close}>
      <div className="hf-shell">
        <div className="hf-panel" onClick={(e) => e.stopPropagation()}>
          <div className="hf-inputwrap">
            <svg
              className="hf-search-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 L13.5 13.5" />
            </svg>
            <input
              ref={inputRef}
              className="hf-input"
              autoFocus
              placeholder="Search history…"
            />
          </div>
          <div className="hf-footer">
            <span>
              <span className="hf-kbd">esc</span> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
