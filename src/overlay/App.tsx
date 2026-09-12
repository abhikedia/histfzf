import { useEffect, useRef, useState } from 'react'
import { MSG } from '../constants'
import { buildSearchRecords, landingList } from '../indexmodel'
import type { IndexResponse, SearchRecord } from '../types'
import { Favicon } from './favicon'
import Highlight from './Highlight'
import { keyToAction, moveSelection } from './keys'
import { createFzf, search, type IndexFinder, type NarrowState, type RankedRow } from './search'

/**
 * The palette. One GET_INDEX per open, then everything lives in RAM.
 * Keyboard-first (§11): ↓/↑ or Ctrl-n/p moves (stops at the ends,
 * never wraps), Enter opens in the same tab, Shift/Cmd/Ctrl+Enter opens
 * a new tab, Esc closes. Hover and keyboard are the same mechanism:
 * mouseenter just moves the selection.
 */
export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLDivElement | null>(null)
  const [records, setRecords] = useState<SearchRecord[] | null>(null)
  const [rows, setRows] = useState<RankedRow[]>([])
  const [selected, setSelected] = useState(0)
  const [query, setQuery] = useState('')

  // Search machinery: one Fzf per index load; narrowing state persists
  // across keystrokes in refs (search itself stays stateless).
  const fzfRef = useRef<IndexFinder | null>(null)
  const narrowRef = useRef<NarrowState>({ query: '', pool: null })

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
        fzfRef.current = createFzf(built)
        narrowRef.current = { query: '', pool: null }
        setRecords(built)
        setRows(landingList(built, Date.now()).map((record) => ({ record, positions: new Set() })))
        setSelected(0)
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
    // Selection follows itself on row list changes — and the scroll
    // follows the selection (block: nearest, never jumps the page).
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, rows])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      const action = keyToAction(e)
      if (action === null) {
        return
      }
      e.preventDefault()
      if (action === 'next') {
        setSelected((cur) => moveSelection(cur, rows.length, +1))
      } else if (action === 'prev') {
        setSelected((cur) => moveSelection(cur, rows.length, -1))
      } else {
        openAt(action === 'new-tab' ? { newTab: true } : { newTab: false }, selected)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rows, selected])

  useEffect(() => {
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

  /** Open the selected/row target: same-tab = navigate the current tab;
   * new-tab = the SW's OPEN_NEW_TAB. The calls differ per mode only in
   * the transport (iframe relays through content; a takeover page acts
   * directly). In both cases the palette dismisses itself. */
  function openAt({ newTab }: { newTab: boolean }, index: number): void {
    const row = rows[index]
    if (!row) {
      return
    }
    // Always the rawUrl — the canonical key is lossy (never navigated).
    const url = row.record.rawUrl
    if (TAKEOVER) {
      if (newTab) {
        chrome.runtime
          .sendMessage({ type: MSG.OPEN_NEW_TAB, url })
          .catch((err) => console.error('[histfzf] open new tab failed', err))
      } else {
        location.assign(url)
      }
      close()
      return
    }
    window.parent.postMessage({ type: MSG.NAVIGATE, url, newTab }, '*')
    if (newTab) {
      // The page stays behind a new tab — dismiss the palette too.
      window.parent.postMessage({ type: MSG.CLOSE }, '*')
    }
  }

  function onQueryChange(next: string): void {
    const built = records
    setQuery(next)
    setSelected(0)
    if (built === null || fzfRef.current === null) {
      return
    }
    if (next === '') {
      narrowRef.current = { query: '', pool: null }
      setRows(landingList(built, Date.now()).map((record) => ({ record, positions: new Set() })))
      return
    }
    const result = search(fzfRef.current, narrowRef.current, next, Date.now())
    narrowRef.current = { query: next, pool: result.pool }
    setRows(result.rows)
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
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </div>
          <div className="hf-rows">
            {records === null ? null : (
              <>
                {query === '' && rows.length > 0 && (
                  <div className="hf-section">FREQUENT</div>
                )}
                {rows.map((row, index) => (
                  <div
                    className={`hf-row${index === selected ? ' hf-row--selected' : ''}`}
                    key={row.record.url}
                    ref={index === selected ? selectedRef : undefined}
                    onMouseEnter={() => setSelected(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openAt({ newTab: false }, index)}
                  >
                    <Favicon rawUrl={row.record.rawUrl} />
                    <div className="hf-rowtext">
                      {row.record.title ? (
                        <>
                          <div className="hf-row__title">
                            <Highlight
                              text={row.record.title}
                              positions={row.positions}
                              offset={0}
                            />
                          </div>
                          <div className="hf-row__url">
                            <Highlight
                              text={row.record.url}
                              positions={row.positions}
                              offset={row.record.titleLen}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="hf-row__title">
                          <Highlight
                            text={row.record.url}
                            positions={row.positions}
                            offset={row.record.titleLen}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {records.length === 0 && <div className="hf-empty">No history indexed yet.</div>}
                {records.length > 0 && rows.length === 0 && (
                  <div className="hf-empty">No results.</div>
                )}
              </>
            )}
          </div>
          <div className="hf-footer">
            <span>
              <span className="hf-kbd">esc</span> Close
            </span>
            <span>
              <span className="hf-kbd">⏎</span> Open
            </span>
            <span>
              <span className="hf-kbd">⇧⏎</span> New tab
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
