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
}

export interface OpenNewTabMsg {
  type: typeof MSG.OPEN_NEW_TAB
  url: string
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

export type SWRequest = GetIndexRequest | OpenNewTabMsg

export type OverlayMessage = NavigateMsg | CloseMsg
