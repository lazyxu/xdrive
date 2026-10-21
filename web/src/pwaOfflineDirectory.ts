/**
 * P1-A: opted-in, read-only directory metadata snapshots.
 *
 * This module deliberately has NO startup side effects and NO connection to
 * Service Worker CacheStorage. Callers must supply a server-verified MeResult
 * identity and must not render cached data as an authorized live directory.
 */
export const XDRIVE_PWA_OFFLINE_MAX_DIRECTORIES = 10
export const XDRIVE_PWA_OFFLINE_MAX_ITEMS_PER_DIRECTORY = 20
export const XDRIVE_PWA_OFFLINE_MAX_ITEMS = 200
export const XDRIVE_PWA_OFFLINE_MAX_RECORD_BYTES = 192 * 1024
export const XDRIVE_PWA_OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const DB_NAME = 'xdrive-pwa-offline-metadata-v2'
const STORE_NAME = 'owner-scopes'
const DB_VERSION = 1
// Only a non-secret hint to locate the last explicitly opted-in scope after a
// browser process restart. This is NOT an authentication token or ACL proof.
const RELAUNCH_HINT_KEY = 'xdrive:pwa:offline-relaunch-owner:v1'

export type XDrivePwaOfflineOwner = {
  origin: string
  userID: number
  username: string
  /** Durable Server-owned UUID fetched through authenticated /me. */
  instanceID: string
}

export type XDrivePwaOfflineCandidate = {
  id: number
  name: string
  type: 'file' | 'dir'
  size?: number
  revision?: number
  updated_at?: string
}

export type XDrivePwaOfflineItem = {
  id: number
  name: string
  type: 'file' | 'dir'
  size: number
  revision: number
  updated_at?: string
}

export type XDrivePwaOfflineDirectory = {
  id: number
  name: string
  totalCount: number | null
  capturedCount: number
  capturedAt: number
  partial: true
  items: XDrivePwaOfflineItem[]
}

type OfflineRelaunchHint = {
  key: typeof RELAUNCH_HINT_KEY
  version: 1
  savedAt: number
  owner: XDrivePwaOfflineOwner
}

type OwnerRecord = {
  key: string
  version: 1
  consented: true
  directories: XDrivePwaOfflineDirectory[]
}

export type XDrivePwaOfflineRead = {
  consented: boolean
  /** Always unverified: reconnect, authenticate and re-read before live use. */
  revalidated: false
  directories: XDrivePwaOfflineDirectory[]
}

function safePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function safeNonnegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function shortName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 128) : ''
}

export function xDrivePwaOfflineScopeKey(owner: XDrivePwaOfflineOwner): string {
  if (!owner || !safePositiveInt(owner.userID) ||
      typeof owner.username !== 'string' || !/^[^\u0000-\u001f]{1,128}$/.test(owner.username) ||
      typeof owner.origin !== 'string' || !/^https?:\/\/[^\s/]+$/i.test(owner.origin) ||
      typeof owner.instanceID !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.instanceID)) {
    throw new Error('Invalid offline metadata owner scope')
  }
  // IndexedDB is same-origin. The explicit origin and immutable server user ID
  // prevent accidental reuse when this code is moved behind another origin.
  if (typeof window !== 'undefined' && owner.origin !== window.location.origin) {
    throw new Error('Offline metadata origin changed')
  }
  return owner.origin + '\u0000' + owner.instanceID + '\u0000' + owner.userID + '\u0000' + owner.username
}

/** Bounded, selective projection. Never serialize a raw Node, URL, token,
 * SHA, media object, original bytes, thumbnail or arbitrary metadata map. */
export function xDrivePwaNormalizeVisitedDirectory(input: {
  id: number
  name: string
  items: readonly XDrivePwaOfflineCandidate[]
  totalCount?: number
  capturedAt?: number
}): XDrivePwaOfflineDirectory | null {
  if (!input || !safePositiveInt(input.id) || !Array.isArray(input.items)) return null
  const name = shortName(input.name)
  if (!name) return null
  const seen = new Set<number>()
  const items: XDrivePwaOfflineItem[] = []
  for (const candidate of input.items.slice(0, XDRIVE_PWA_OFFLINE_MAX_ITEMS_PER_DIRECTORY)) {
    const id = safePositiveInt(candidate?.id)
    const itemName = shortName(candidate?.name)
    if (!id || !itemName || seen.has(id) ||
        (candidate.type !== 'dir' && candidate.type !== 'file')) continue
    seen.add(id)
    const item: XDrivePwaOfflineItem = {
      id,
      name: itemName,
      type: candidate.type,
      size: safeNonnegativeInt(candidate.size),
      revision: safeNonnegativeInt(candidate.revision),
    }
    if (typeof candidate.updated_at === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(candidate.updated_at) &&
        candidate.updated_at.length <= 40) item.updated_at = candidate.updated_at
    items.push(item)
  }
  const capturedAt = safePositiveInt(input.capturedAt) ?? Date.now()
  const count = input.totalCount
  return {
    id: input.id,
    name,
    totalCount: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null,
    capturedCount: items.length,
    capturedAt,
    // Sparse virtual pages must NEVER masquerade as a complete directory.
    partial: true,
    items,
  }
}

/** The limits apply to the complete per-account record, not per request. */
export function xDrivePwaBoundedDirectories(
  newest: XDrivePwaOfflineDirectory,
  prior: readonly XDrivePwaOfflineDirectory[],
): XDrivePwaOfflineDirectory[] {
  const collected: XDrivePwaOfflineDirectory[] = [newest]
  const seen = new Set<number>([newest.id])
  let count = newest.items.length
  for (const directory of prior) {
    if (collected.length >= XDRIVE_PWA_OFFLINE_MAX_DIRECTORIES) break
    if (!safePositiveInt(directory?.id) || seen.has(directory.id)) continue
    seen.add(directory.id)
    const remaining = XDRIVE_PWA_OFFLINE_MAX_ITEMS - count
    if (remaining <= 0) break
    const clipped = { ...directory, items: directory.items.slice(0, remaining) }
    clipped.capturedCount = clipped.items.length
    count += clipped.capturedCount
    collected.push(clipped)
  }
  return collected
}

function offlineSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'indexedDB' in window
}

function openDatabase(): Promise<IDBDatabase> {
  if (!offlineSupported()) return Promise.reject(new Error('Secure IndexedDB unavailable'))
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline metadata database open failed'))
    request.onblocked = () => reject(new Error('Offline metadata database upgrade blocked'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    let finished = false
    let value: T
    let transaction: IDBTransaction
    try { transaction = database.transaction(STORE_NAME, mode) }
    catch (error) { database.close(); reject(error); return }
    const fail = () => {
      if (finished) return
      finished = true
      database.close()
      reject(transaction.error || new Error('Offline metadata transaction failed'))
    }
    transaction.onabort = fail
    transaction.onerror = fail
    transaction.oncomplete = () => {
      if (finished) return
      finished = true
      database.close()
      resolve(value)
    }
    try { run(transaction.objectStore(STORE_NAME), next => { value = next }) }
    catch (error) {
      transaction.abort()
      if (!finished) {
        finished = true
        database.close()
        reject(error)
      }
    }
  })
}

export function xDrivePwaOfflineAvailable(): boolean {
  return offlineSupported()
}

/** No implicit opt-in. Consent is persisted atomically with the record. */
export async function xDrivePwaSetOfflineConsent(
  owner: XDrivePwaOfflineOwner, enabled: boolean,
): Promise<void> {
  const key = xDrivePwaOfflineScopeKey(owner)
  await withStore<void>('readwrite', (store, done) => {
    if (!enabled) {
      store.delete(key)
      const last = store.get(RELAUNCH_HINT_KEY)
      last.onsuccess = () => {
        const hint = last.result as OfflineRelaunchHint | undefined
        if (hint?.version === 1) {
          try {
            if (xDrivePwaOfflineScopeKey(hint.owner) === key) store.delete(RELAUNCH_HINT_KEY)
          } catch {
            store.delete(RELAUNCH_HINT_KEY)
          }
        }
        done(undefined)
      }
      return
    }
    const request = store.get(key)
    request.onsuccess = () => {
      const existing = request.result as OwnerRecord | undefined
      const directories = existing?.version === 1 && existing?.consented === true &&
        Array.isArray(existing.directories) ? existing.directories : []
      store.put({ key, version: 1, consented: true, directories } satisfies OwnerRecord)
      store.put({
        key: RELAUNCH_HINT_KEY, version: 1, savedAt: Date.now(), owner: { ...owner },
      } satisfies OfflineRelaunchHint)
      done(undefined)
    }
  })
  if (!enabled) xDrivePwaBroadcastOfflinePurge()
}

export async function xDrivePwaCaptureVisitedDirectory(
  owner: XDrivePwaOfflineOwner,
  input: Parameters<typeof xDrivePwaNormalizeVisitedDirectory>[0],
): Promise<boolean> {
  const key = xDrivePwaOfflineScopeKey(owner)
  const snapshot = xDrivePwaNormalizeVisitedDirectory(input)
  if (!snapshot) return false
  return withStore<boolean>('readwrite', (store, done) => {
    const request = store.get(key)
    request.onsuccess = () => {
      const existing = request.result as OwnerRecord | undefined
      // Consent check and replacement MUST share the same transaction.
      // Logout/disable deletes this record; in-flight writes cannot revive it.
      if (existing?.version !== 1 || existing.consented !== true ||
          !Array.isArray(existing.directories)) { done(false); return }
      const directories = xDrivePwaBoundedDirectories(snapshot, existing.directories)
      const next: OwnerRecord = { key, version: 1, consented: true, directories }
      if (new TextEncoder().encode(JSON.stringify(next)).byteLength > XDRIVE_PWA_OFFLINE_MAX_RECORD_BYTES) {
        done(false)
        return
      }
      // Refresh the relaunch TTL only for this still-active consent hint.
      // An obsolete in-flight capture for a different Owner must not take
      // over the currently selected offline identity.
      const hintRead = store.get(RELAUNCH_HINT_KEY)
      hintRead.onsuccess = () => {
        const hint = hintRead.result as OfflineRelaunchHint | undefined
        if (hint?.version === 1) {
          try {
            if (xDrivePwaOfflineScopeKey(hint.owner) === key) {
              store.put({ ...hint, savedAt: Date.now() } satisfies OfflineRelaunchHint)
            }
          } catch { /* keep the untrusted invalid hint from becoming active */ }
        }
        store.put(next)
        done(true)
      }
    }
  })
}

/** A cached record is never a live ACL proof, even when navigator.onLine=true. */
export async function xDrivePwaReadOfflineDirectories(owner: XDrivePwaOfflineOwner): Promise<XDrivePwaOfflineRead> {
  const key = xDrivePwaOfflineScopeKey(owner)
  return withStore<XDrivePwaOfflineRead>('readonly', (store, done) => {
    const request = store.get(key)
    request.onsuccess = () => {
      const record = request.result as OwnerRecord | undefined
      if (record?.version !== 1 || record.consented !== true || !Array.isArray(record.directories)) {
        done({ consented: false, revalidated: false, directories: [] })
        return
      }
      const now = Date.now()
      // Treat same-origin IDB as untrusted input. Never render over-limit or
      // non-whitelisted fields even if a stale/corrupt record was injected.
      const directories = record.directories.slice(0, XDRIVE_PWA_OFFLINE_MAX_DIRECTORIES)
        .flatMap(directory => {
          if (!directory || !Number.isSafeInteger(directory.capturedAt) ||
              directory.capturedAt > now || now - directory.capturedAt > XDRIVE_PWA_OFFLINE_MAX_AGE_MS ||
              !Array.isArray(directory.items)) return []
          const sanitized = xDrivePwaNormalizeVisitedDirectory({
            id: directory.id, name: directory.name,
            capturedAt: directory.capturedAt,
            totalCount: directory.totalCount ?? undefined,
            items: directory.items.slice(0, XDRIVE_PWA_OFFLINE_MAX_ITEMS_PER_DIRECTORY),
          })
          return sanitized ? [sanitized] : []
        })
      done({ consented: true, revalidated: false, directories })
    }
  })
}

/** The offline relaunch hint is an explicit-consent locator, never proof
 * that a previous login or directory permission is still valid. */
export async function xDrivePwaReadRelaunchOwner(): Promise<XDrivePwaOfflineOwner | null> {
  if (!offlineSupported()) return null
  return withStore<XDrivePwaOfflineOwner | null>('readonly', (store, done) => {
    const hintRead = store.get(RELAUNCH_HINT_KEY)
    hintRead.onsuccess = () => {
      const hint = hintRead.result as OfflineRelaunchHint | undefined
      const now = Date.now()
      if (!hint || hint.key !== RELAUNCH_HINT_KEY || hint.version !== 1 ||
          !Number.isSafeInteger(hint.savedAt) || hint.savedAt > now ||
          now - hint.savedAt > XDRIVE_PWA_OFFLINE_MAX_AGE_MS) {
        done(null)
        return
      }
      let scope: string
      try { scope = xDrivePwaOfflineScopeKey(hint.owner) }
      catch { done(null); return }
      const recordRead = store.get(scope)
      recordRead.onsuccess = () => {
        const record = recordRead.result as OwnerRecord | undefined
        done(record?.version === 1 && record.consented === true &&
          Array.isArray(record.directories) ? { ...hint.owner } : null)
      }
    }
  })
}

export function xDrivePwaVerifiedIdentityMatches(owner: XDrivePwaOfflineOwner, me: {
  id: number
  username: string
  must_change_password?: boolean
  pwa_offline_instance_id?: string
}): boolean {
  if (!me || me.must_change_password || !me.pwa_offline_instance_id) return false
  try {
    return xDrivePwaOfflineScopeKey(owner) === xDrivePwaOfflineScopeKey({
      origin: owner.origin, userID: me.id, username: me.username,
      instanceID: me.pwa_offline_instance_id,
    })
  } catch { return false }
}

/** Invoke on sign-out/auth switch, including when offline; never clear the
 * browser's public App Shell CacheStorage or unrelated local preferences. */
export async function xDrivePwaClearOfflineMetadata(): Promise<void> {
  if (!offlineSupported()) return
  await withStore<void>('readwrite', (store, done) => {
    store.clear()
    done(undefined)
  })
  xDrivePwaBroadcastOfflinePurge()
}

function xDrivePwaBroadcastOfflinePurge(): void {
  // A peer must discard a rendered snapshot after logout or consent removal.
  // Broadcast contains no credentials, Owner identifiers, or file names.
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel('xdrive-pwa-offline-purge')
  channel.postMessage({ kind: 'xdrive-pwa-offline-purge' })
  channel.close()
}

export function xDrivePwaObserveOfflinePurge(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel('xdrive-pwa-offline-purge')
  channel.onmessage = event => {
    if (event.data?.kind === 'xdrive-pwa-offline-purge') listener()
  }
  return () => channel.close()
}
