/**
 * Only anonymous, short-lived cross-window busy hints for PWA update UX.
 * No presence/idle message can authorize Service Worker activation or reload.
 */
import {
  subscribeXDrivePwaWindowActivity,
  xDrivePwaKnownWindowBlockers,
  xDrivePwaWindowActivitySnapshot,
} from './pwaWorkloadSafety'

export type XDrivePwaPeerActivitySnapshot = Readonly<{
  available: boolean
  knownPeerBusy: boolean
  knownPeerUnknown: boolean
  recentlyObservedPeers: number
}>
type PeerRecord = { sequence: number; receivedAt: number; observed: boolean; busy: boolean }
type PeerMessage = {
  kind: 'hello' | 'status'
  sender: string
  sequence?: number
  observed?: boolean
  busy?: boolean
}

const channelName = 'xdrive-pwa-workload-hints-v1'
const heartbeatMS = 15000
const peerExpiryMS = 45000
const maxPeerRecords = 32
const senderPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const empty: XDrivePwaPeerActivitySnapshot = Object.freeze({
  available: false, knownPeerBusy: false, knownPeerUnknown: false, recentlyObservedPeers: 0,
})
let current = empty
let started = false
let channel: BroadcastChannel | null = null
let sender: string | null = null
let sequence = 0
let overflow = false
const peers = new Map<string, PeerRecord>()
const subscribers = new Set<() => void>()

export function xDrivePwaPeerActivitySnapshot(): XDrivePwaPeerActivitySnapshot {
  return current
}
export function subscribeXDrivePwaPeerActivity(listener: () => void): () => void {
  subscribers.add(listener)
  return () => { subscribers.delete(listener) }
}
function pruneExpired(now: number) {
  for (const [id, item] of peers) {
    const age = now - item.receivedAt
    if (age > peerExpiryMS || age < -peerExpiryMS) peers.delete(id)
  }
}
function publish(now = Date.now()) {
  pruneExpired(now)
  const records = Array.from(peers.values())
  const next: XDrivePwaPeerActivitySnapshot = {
    available: Boolean(channel),
    knownPeerBusy: records.some(p => p.observed && p.busy),
    knownPeerUnknown: overflow || records.some(p => !p.observed),
    recentlyObservedPeers: records.length,
  }
  if (Object.keys(next).every(key =>
    next[key as keyof XDrivePwaPeerActivitySnapshot] ===
      current[key as keyof XDrivePwaPeerActivitySnapshot])) return
  current = Object.freeze(next)
  for (const listener of subscribers) listener()
}
function send(message: PeerMessage) {
  try { channel?.postMessage(message) } catch {
    // No recovery path may mistake a failed channel for safe idle windows.
    channel?.close()
    channel = null
    publish()
  }
}
function broadcastStatus() {
  if (!sender || !channel) return
  const local = xDrivePwaWindowActivitySnapshot()
  send({
    kind: 'status', sender, sequence: ++sequence,
    observed: local.observed,
    busy: local.observed && xDrivePwaKnownWindowBlockers(local).length > 0,
  })
}
function acceptMessage(data: unknown) {
  if (!data || typeof data !== 'object') return
  const message = data as Partial<PeerMessage>
  if (typeof message.sender !== 'string' || !senderPattern.test(message.sender) ||
      message.sender === sender) return
  if (message.kind === 'hello') {
    broadcastStatus()
    return
  }
  if (message.kind !== 'status' || !Number.isSafeInteger(message.sequence) ||
      (message.sequence ?? 0) < 1 || typeof message.busy !== 'boolean' ||
      typeof message.observed !== 'boolean' ||
      (message.busy && !message.observed)) return
  const existing = peers.get(message.sender)
  if (existing && (message.sequence ?? 0) <= existing.sequence) return
  pruneExpired(Date.now())
  if (!existing && peers.size >= maxPeerRecords) {
    overflow = true
    publish()
    return
  }
  peers.set(message.sender, {
    sequence: message.sequence!, receivedAt: Date.now(),
    busy: message.busy, observed: message.observed,
  })
  publish()
}

/** Only the ordinary Web/Mobile Web entry starts this. No auth or API calls. */
export function startXDrivePwaPeerActivityObservation(): void {
  if (started || typeof window === 'undefined') return
  started = true
  if (!window.isSecureContext || typeof BroadcastChannel === 'undefined' ||
      typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return
  try {
    sender = crypto.randomUUID()
    channel = new BroadcastChannel(channelName)
  } catch {
    channel = null
    sender = null
    return
  }
  channel.addEventListener('message', (event: MessageEvent) => { acceptMessage(event.data) })
  subscribeXDrivePwaWindowActivity(broadcastStatus)
  window.addEventListener('pageshow', broadcastStatus)
  window.addEventListener('pagehide', () => {
    // A frozen tab is unknown, never a positive "all clear" signal.
    if (sender && channel) send({ kind: 'status', sender, sequence: ++sequence,
      observed: false, busy: false })
  })
  document.addEventListener('visibilitychange', broadcastStatus)
  window.setInterval(() => { broadcastStatus(); publish() }, heartbeatMS)
  publish()
  if (sender) send({ kind: 'hello', sender })
  broadcastStatus()
}
