import type { HistFzfSettings } from './settings'
import { MSG } from './constants'

export interface PageRecord {
  url: string
  rawUrl: string
  title: string
  host: string
  visitCount: number
  typedCount: number
  firstVisit: number
  lastVisit: number
}

export interface SearchRecord extends PageRecord {
  haystack: string
  titleLen: number
  freq: number
}

export interface GetIndexRequest {
  type: typeof MSG.GET_INDEX
}

export interface IndexResponse {
  records: PageRecord[]
  settings: HistFzfSettings
}

export interface OpenNewTabMsg {
  type: typeof MSG.OPEN_NEW_TAB
  url: string
}

/** Same-tab takeover dismissal (option C): the palette's disposable
 * tab asks the SW to remove it (Chrome then re-activates the tab that
 * was just before it). sender.tab identity carries the tab id. */
export interface RestoreTabMsg {
  type: typeof MSG.RESTORE_TAB
}

export interface NavigateMsg {
  type: typeof MSG.NAVIGATE
  url: string
  newTab: boolean
}

export interface CloseMsg {
  type: typeof MSG.CLOSE
}

export interface ShowMsg {
  type: typeof MSG.SHOW
}

export type SWRequest = GetIndexRequest | OpenNewTabMsg | RestoreTabMsg

export type OverlayMessage = NavigateMsg | CloseMsg

/** Type guard for messages arriving at the service worker — the one
 * place every SWRequest variant is consumed. Anything else (hostile
 * pages included) narrows to nothing. */
export function isSWRequest(value: unknown): value is SWRequest {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const type = (value as { type?: unknown }).type
  return (
    type === MSG.GET_INDEX ||
    type === MSG.OPEN_NEW_TAB ||
    type === MSG.RESTORE_TAB
  )
}
