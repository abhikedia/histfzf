import { useEffect, useRef, useState } from 'react'
import { MSG } from '../constants'
import { buildSearchRecords, landingList } from '../indexmodel'
import type { IndexResponse, SearchRecord } from '../types'
import { Favicon } from './favicon'

/**
 * The palette. Index model: one GET_INDEX per open, then everything
 * lives in RAM — landing list on empty query (search arrives next).
 * Row rendering: favicon + title/URL, with the empty-title fallback
 * (URL becomes primary, no secondary line — a row is never empty).
 */
export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [records, setRecords] = useState<SearchRecord[] | null>(null)
  const [rows, setRows] = useState<SearchRecord[]>([])
  // Deployment mode: 'mode=tab' = takeover — the palette page IS the tab.
  const TAKEOVER = new URLSearchParams(location.search).get('mode') === 'tab'

  useEffect(() => {
    let cancelled = false
    chrome.runtime
      .sendMessage({ type: MSG.GET_INDEX })
      .then((res: IndexResponse | undefined) => {
        if (cancelled) {
          return
        }
        const built = buildSearchRecords(res?.records ?? [])
        // Search arrives in the next commit; empty query = landing list.
        setRecords(built)
        setRows(landingList(built, Date.now()))
      })
      .catch((err) => {
        console.error('[histfzf] GET_INDEX failed', err)
        setRecords([])
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
    // SHOW → focus the input and select its text (mount + every re-show
    // after toggle). A forged SHOW is harmless (focus only).
    if (TAKEOVER) {
      return
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return
      }
      if (event.data?.type === MSG.SHOW) {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    // TAKEOVER focus: tabs-create navigations deliver focus naturally —
    // claim it (immediate + next tick) and whenever the window regains it.
    if (!TAKEOVER) {
      return
    }
    const focusInput = () => inputRef.current?.focus()
    const timers = [0, 60].map((delay) => setTimeout(focusInput, delay))
    window.addEventListener('focus', focusInput)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('focus', focusInput)
    }
  }, [])

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
          <div className="hf-rows">
            {records === null ? null : (
              <>
                {rows.length > 0 && <div className="hf-section">FREQUENT</div>}
                {rows.map((row) => (
                  <div className="hf-row" key={row.url}>
                    <Favicon rawUrl={row.rawUrl} />
                    <div className="hf-rowtext">
                      {row.title ? (
                        <>
                          <div className="hf-row__title">{row.title}</div>
                          <div className="hf-row__url">{row.url}</div>
                        </>
                      ) : (
                        <div className="hf-row__title">{row.url}</div>
                      )}
                    </div>
                  </div>
                ))}
                {records.length === 0 && <div className="hf-empty">No history indexed yet.</div>}
              </>
            )}
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
