export const DB_NAME = 'histfzf'
export const DB_VERSION = 1
export const STORE_PAGES = 'pages'
export const IDX_LAST_VISIT = 'by_lastVisit'
export const IDX_HOST = 'by_host'

export const SEED_WINDOW_DAYS = 7
export const SEED_MAX_RESULTS = 10000
export const SEED_WM_KEY = 'seedWatermark'
export const SEED_DONE_KEY = 'seedComplete'
export const SEED_MAX_WINDOWS = 520

export const W_FRECENCY_FREQ = 1.0
export const W_FRECENCY_REC = 1.0
export const RECENCY_HALFLIFE_DAYS = 14
export const FRECENCY_CAP = 1.0
export const TYPED_WEIGHT = 2

export const RENDER_CAP = 50
export const FZF_POOL_SIZE = 500
export const LANDING_SIZE = 10

export const DAY_MS = 86_400_000

export const IFRAME_ID = 'histfzf-overlay-frame'

export const MSG = {
  GET_INDEX: 'GET_INDEX',
  OPEN_NEW_TAB: 'OPEN_NEW_TAB',
  RESTORE_TAB: 'RESTORE_TAB',
  NAVIGATE: 'NAVIGATE',
  CLOSE: 'CLOSE',
  SHOW: 'SHOW',
} as const
