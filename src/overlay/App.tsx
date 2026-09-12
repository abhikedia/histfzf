import { useEffect, useRef } from 'react'
import { MSG } from '../constants'

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    chrome.runtime
      .sendMessage({ type: MSG.GET_INDEX })
      .then((res) => {
        if (cancelled) {
          return
        }
        // M0: the response proof lives in the call itself — a resolved
        // promise here IS the D9 round-trip check. Logging every index
        // load would be console noise; the M2 commits use this record
        // array directly.
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
    // Esc closes from ANYWHERE inside the iframe — not only while the
    // input happens to hold focus.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.parent.postMessage({ type: MSG.CLOSE }, '*')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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

  function close() {
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
