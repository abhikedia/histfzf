import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import {
  DB_NAME,
  DB_VERSION,
  IDX_HOST,
  IDX_LAST_VISIT,
  STORE_PAGES,
} from './constants'
import { canonicalize } from './urlcanon'
import type { PageRecord } from './types'

interface HistFzfDB extends DBSchema {
  pages: {
    key: string
    value: PageRecord
    indexes: {
      [IDX_LAST_VISIT]: number
      [IDX_HOST]: string
    }
  }
}

let dbPromise: Promise<IDBPDatabase<HistFzfDB>> | null = null

function getDB(): Promise<IDBPDatabase<HistFzfDB>> {
  dbPromise ??= openDB<HistFzfDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      switch (oldVersion) {
        case 0: {
          const pages = db.createObjectStore(STORE_PAGES, { keyPath: 'url' })
          pages.createIndex(IDX_LAST_VISIT, 'lastVisit')
          pages.createIndex(IDX_HOST, 'host')
          break
        }
        default:
          break
      }
    },
  })
  return dbPromise
}

/** Test seam: close the cached connection so a fresh fake-indexeddb
 * factory (or a deleteDatabase in beforeEach) takes effect. */
export async function resetForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
}

function hostOf(canonicalKey: string): string {
  try {
    return new URL(canonicalKey).hostname
  } catch {
    return ''
  }
}

/** Seed merge: Chrome aggregates repeat across seed windows —
 * max counts/latest visit/earliest first-visit win (plan, commit 5). */
function mergeInto(
  existing: PageRecord,
  incoming: PageRecord,
): PageRecord {
  return {
    url: existing.url,
    rawUrl: incoming.rawUrl,
    host: existing.host || incoming.host,
    title: existing.title || incoming.title,
    visitCount: Math.max(existing.visitCount, incoming.visitCount),
    typedCount: Math.max(existing.typedCount, incoming.typedCount),
    firstVisit: Math.min(existing.firstVisit, incoming.firstVisit),
    lastVisit: Math.max(existing.lastVisit, incoming.lastVisit),
  }
}

export async function getAll(): Promise<PageRecord[]> {
  const db = await getDB()
  return db.getAll(STORE_PAGES)
}

export async function bulkPut(records: PageRecord[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_PAGES, 'readwrite')
  await Promise.all([...records.map((record) => tx.store.put(record)), tx.done])
}

export interface HistoryItemRaw {
  url?: string
  title?: string
  visitCount?: number
  typedCount?: number
  lastVisitTime?: number
}

/** Seed path: import a Chrome history item with its AGGREGATE counts.
 * Canonicalizes internally; returns null (nothing written) for
 * non-http(s)/unparseable URLs. */
export async function importHistoryItem(
  raw: HistoryItemRaw,
): Promise<PageRecord | null> {
  if (!raw.url) {
    return null
  }
  const key = canonicalize(raw.url)
  if (key === null) {
    return null
  }
  const lastVisit = raw.lastVisitTime ?? Date.now()
  const incoming: PageRecord = {
    url: key,
    rawUrl: raw.url,
    title: raw.title ?? '',
    host: hostOf(key),
    visitCount: raw.visitCount ?? 1,
    typedCount: raw.typedCount ?? 0,
    firstVisit: lastVisit,
    lastVisit,
  }

  const db = await getDB()
  const tx = db.transaction(STORE_PAGES, 'readwrite')
  const existing = await tx.store.get(key)
  const merged = existing ? mergeInto(existing, incoming) : incoming
  await tx.store.put(merged)
  await tx.done
  return merged
}

/** Live path: exactly one visit happened at visitTimeMs.
 * Increments (never overwrites) counts; never touches title (D2). */
export async function recordVisit(
  canonKey: string,
  rawUrl: string,
  visitTimeMs: number,
  isTyped: boolean,
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_PAGES, 'readwrite')
  const existing = await tx.store.get(canonKey)
  if (existing) {
    await tx.store.put({
      url: existing.url,
      rawUrl,
      title: existing.title,
      host: existing.host || hostOf(canonKey),
      visitCount: existing.visitCount + 1,
      typedCount: existing.typedCount + (isTyped ? 1 : 0),
      firstVisit: existing.firstVisit,
      lastVisit: visitTimeMs,
    })
  } else {
    await tx.store.put({
      url: canonKey,
      rawUrl,
      title: '',
      host: hostOf(canonKey),
      visitCount: 1,
      typedCount: isTyped ? 1 : 0,
      firstVisit: visitTimeMs,
      lastVisit: visitTimeMs,
    })
  }
  await tx.done
}

/** Title updates arrive from tabs.onUpdated and fire redundantly (D2).
 * The triple no-op guard (missing record / empty title / unchanged)
 * is the redundant-write protection — background.ts adds nothing. */
export async function updateTitle(
  canonKey: string,
  title: string,
): Promise<void> {
  if (!title) {
    return
  }
  const db = await getDB()
  const tx = db.transaction(STORE_PAGES, 'readwrite')
  const existing = await tx.store.get(canonKey)
  if (!existing || existing.title === title) {
    await tx.done
    return
  }
  await tx.store.put({ ...existing, title })
  await tx.done
}

// delete every page whose lastVisit is older than this timestamp; tell me how many left
export async function pruneBefore(timestampMs: number): Promise<number> {
  const db = await getDB()
  const tx = db.transaction(STORE_PAGES, 'readwrite')
  const idx = tx.store.index(IDX_LAST_VISIT)
  let deleted = 0
  let cursor = await idx.openCursor(IDBKeyRange.upperBound(timestampMs, true))
  while (cursor) {
    await cursor.delete()
    deleted += 1
    cursor = await cursor.continue()
  }
  await tx.done
  return deleted
}
