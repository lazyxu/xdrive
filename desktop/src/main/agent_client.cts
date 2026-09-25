import { readFile } from 'node:fs/promises'

export type AgentHello = {
  discovery_version: number
  protocol_min: number
  protocol_max: number
  agent_version: string
  pid: number
  platform: string
  arch: string
  capabilities: string[]
}

export type AgentStatus = {
  revision: number
  configured: boolean
  username?: string
  server?: string
  mount_path?: string
  auth_status: string
  sync_status: string
  paused: boolean
  must_change_password: boolean
  last_error?: string
  has_conflict: boolean
  conflict_count: number
  version: string
}

export type AgentSettings = {
  mount_path: string
  cache_limit_bytes: number
  sync_rules: Array<{ path: string; mode: string }>
}

export type AgentFileAvailability = {
  Path: string
  Mode: string
  Placeholder: boolean
  Pinned: boolean
  OnlineOnly: boolean
  AvailableOffline: boolean
  InSync: boolean
  Syncing: boolean
}

export type AgentConflict = {
  id: string
  server?: string
  username?: string
  original_path: string
  conflict_path: string
  original_node_id?: number
  conflict_node_id?: number
  created_at: string
}

export type AgentStatusEvent = {
  type: 'status.changed'
  revision: number
  status: AgentStatus
}

export type AgentTransfer = {
  id: string
  file_name: string
  path?: string
  kind: 'upload' | 'download' | 'hydration' | 'dehydration' | string
  direction: 'upload' | 'download' | 'local' | string
  state: 'running' | 'completed' | 'failed' | 'retrying' | string
  bytes_done: number
  bytes_total: number
  percent: number
  instant_bytes_per_second: number
  average_bytes_per_second: number
  elapsed_ms: number
  error?: string
  retry_count: number
  retryable: boolean
  started_at: string
  updated_at: string
  completed_at?: string
}

export type AgentTransfers = {
  revision: number
  transfers: AgentTransfer[]
}

export type AgentTransferEvent = {
  type: 'transfers.changed'
  revision: number
  transfers: AgentTransfer[]
}

export type AgentDiagnosticCheck = {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL'
  detail: string
}

export type AgentDiagnosticReport = {
  generated_at: string
  platform: string
  arch: string
  checks: AgentDiagnosticCheck[]
  summary: { pass: number; warn: number; fail: number }
}

type AgentDiscovery = {
  version: number
  base_url: string
  token: string
  pid: number
}

export class AgentIPCError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'AgentIPCError'
    this.code = code
    this.status = status
  }
}

export class AgentIPCClient {
  static readonly protocolMin = 1
  static readonly protocolMax = 1

  private readonly discoveryPath: string
  private discovery: AgentDiscovery | null = null

  constructor(discoveryPath: string) {
    this.discoveryPath = discoveryPath
  }

  invalidate() {
    this.discovery = null
  }

  async hello(signal?: AbortSignal) {
    let hello: AgentHello
    try {
      hello = await this.request<AgentHello>('GET', '/v1/hello', undefined, 10_000, signal)
    } catch (error) {
      if (error instanceof AgentIPCError && error.status === 404) {
        throw new AgentIPCError(
          'incompatible_agent',
          404,
          'xdrive-agent is too old for this xDrive Desktop version. Update the xDrive Core package.',
        )
      }
      throw error
    }
    if (
      hello.protocol_max < AgentIPCClient.protocolMin ||
      hello.protocol_min > AgentIPCClient.protocolMax
    ) {
      throw new AgentIPCError(
        'incompatible_agent',
        0,
        `Desktop IPC protocol mismatch: desktop supports ${AgentIPCClient.protocolMin}-${AgentIPCClient.protocolMax}, agent supports ${hello.protocol_min}-${hello.protocol_max}.`,
      )
    }
    return hello
  }

  status(signal?: AbortSignal) {
    return this.request<AgentStatus>('GET', '/v1/status', undefined, 10_000, signal)
  }

  events(afterRevision: number, timeoutMs = 25_000, signal?: AbortSignal) {
    const query = new URLSearchParams({
      after_revision: String(afterRevision),
      timeout_ms: String(timeoutMs),
    })
    return this.request<AgentStatusEvent | null>(
      'GET',
      `/v1/events?${query.toString()}`,
      undefined,
      Math.min(timeoutMs + 5_000, 35_000),
      signal,
    )
  }

  login(input: { server: string; username: string; password: string; mount_path?: string }) {
    return this.request<AgentStatus>('POST', '/v1/auth/login', input, 35_000)
  }

  logout() {
    return this.request<AgentStatus>('POST', '/v1/auth/logout')
  }

  changePassword(input: { current_password: string; new_password: string }) {
    return this.request<AgentStatus>('POST', '/v1/auth/change-password', input, 35_000)
  }

  setPaused(paused: boolean) {
    return this.request<AgentStatus>('POST', paused ? '/v1/sync/pause' : '/v1/sync/resume')
  }

  syncNow() {
    return this.request<AgentStatus>('POST', '/v1/sync/now')
  }

  settings() {
    return this.request<AgentSettings>('GET', '/v1/settings')
  }

  updateSettings(input: { mount_path?: string; cache_limit_bytes?: number }) {
    return this.request<AgentSettings>('PATCH', '/v1/settings', input)
  }

  setSyncRule(path: string, mode: 'exclude' | 'always-local' | 'default') {
    return this.request<AgentSettings>('PUT', '/v1/settings/sync-rule', { path, mode })
  }

  fileAvailability(path: string) {
    const query = new URLSearchParams({ path })
    return this.request<AgentFileAvailability>('GET', `/v1/file-availability?${query.toString()}`)
  }

  setFileAvailability(path: string, action: 'keep' | 'release' | 'online' | 'sync') {
    return this.request<AgentFileAvailability | { ok: boolean }>('POST', '/v1/file-availability', { path, action }, 130_000)
  }

  transfers() {
    return this.request<AgentTransfers>('GET', '/v1/transfers')
  }

  transferEvents(afterRevision: number, timeoutMs = 25_000, signal?: AbortSignal) {
    const query = new URLSearchParams({
      after_revision: String(afterRevision),
      timeout_ms: String(timeoutMs),
    })
    return this.request<AgentTransferEvent | null>(
      'GET',
      `/v1/transfer-events?${query.toString()}`,
      undefined,
      Math.min(timeoutMs + 5_000, 35_000),
      signal,
    )
  }

  retryTransfer(id: string) {
    return this.request<AgentTransfers>('POST', '/v1/transfers/retry', { id }, 130_000)
  }

  diagnostics() {
    return this.request<AgentDiagnosticReport>('GET', '/v1/diagnostics', undefined, 60_000)
  }

  diagnosticReport() {
    return this.request<{ report: string }>('GET', '/v1/diagnostics/report', undefined, 60_000)
  }

  reconnect() {
    return this.request<AgentStatus>('POST', '/v1/diagnostics/reconnect', undefined, 45_000)
  }

  repairSyncRoot() {
    return this.request<AgentStatus>('POST', '/v1/diagnostics/repair-sync-root', undefined, 45_000)
  }

  openLogs() {
    return this.request<{ ok: boolean }>('POST', '/v1/diagnostics/open-logs')
  }

  async conflicts() {
    const result = await this.request<{ conflicts: AgentConflict[] }>('GET', '/v1/conflicts')
    return result.conflicts
  }

  openConflict(id: string, both: boolean) {
    return this.request<{ ok: boolean }>('POST', '/v1/conflicts/open', { id, both })
  }

  resolveConflict(id: string, choice: 'server' | 'local') {
    return this.request<{ ok: boolean }>('POST', '/v1/conflicts/resolve', { id, choice }, 130_000)
  }

  openFolder() {
    return this.request<{ ok: boolean }>('POST', '/v1/open-folder')
  }

  shutdown() {
    return this.request<{ ok: boolean }>('POST', '/v1/lifecycle/shutdown')
  }

  private async loadDiscovery(force = false): Promise<AgentDiscovery> {
    if (this.discovery && !force) return this.discovery
    let raw: string
    try {
      raw = await readFile(this.discoveryPath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new AgentIPCError(
        'agent_unavailable',
        0,
        code === 'ENOENT'
          ? 'xdrive-agent is not running or has not published Desktop IPC yet.'
          : 'Unable to read xdrive-agent Desktop IPC discovery data.',
      )
    }

    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new AgentIPCError('invalid_discovery', 0, 'xdrive-agent Desktop IPC discovery data is invalid.')
    }
    const discovery = validateDiscovery(value)
    this.discovery = discovery
    return discovery
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    timeoutMs = 10_000,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const discovery = await this.loadDiscovery(attempt > 0)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const abort = () => controller.abort()
      externalSignal?.addEventListener('abort', abort, { once: true })

      try {
        const response = await fetch(new URL(endpoint, discovery.base_url), {
          method,
          headers: {
            Authorization: `Bearer ${discovery.token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: controller.signal,
        })

        if (response.status === 204) return null as T

        const text = await response.text()
        let payload: unknown = {}
        if (text) {
          try {
            payload = JSON.parse(text)
          } catch {
            throw new AgentIPCError('invalid_response', response.status, 'xdrive-agent returned invalid JSON.')
          }
        }

        if (!response.ok) {
          const errorPayload = payload as { error?: unknown; message?: unknown }
          const code = typeof errorPayload.error === 'string' ? errorPayload.error : 'agent_error'
          const message = typeof errorPayload.message === 'string'
            ? errorPayload.message
            : `xdrive-agent request failed with HTTP ${response.status}.`
          const apiError = new AgentIPCError(code, response.status, message)
          if (response.status === 401 && attempt === 0) {
            this.invalidate()
            lastError = apiError
            continue
          }
          throw apiError
        }
        return payload as T
      } catch (error) {
        if (externalSignal?.aborted) {
          throw new AgentIPCError('aborted', 0, 'Desktop IPC request was cancelled.')
        }
        if (error instanceof AgentIPCError) throw error
        lastError = error
        this.invalidate()
        if (attempt === 0) continue
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', abort)
      }
    }

    throw new AgentIPCError(
      'agent_unavailable',
      0,
      lastError instanceof Error ? `xdrive-agent is not reachable: ${lastError.message}` : 'xdrive-agent is not reachable.',
    )
  }
}

function validateDiscovery(value: unknown): AgentDiscovery {
  if (!value || typeof value !== 'object') {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery must be an object.')
  }
  const discovery = value as Partial<AgentDiscovery>
  if (discovery.version !== 1) {
    throw new AgentIPCError('unsupported_ipc_version', 0, 'Unsupported xdrive-agent Desktop IPC version.')
  }
  if (typeof discovery.base_url !== 'string' || typeof discovery.token !== 'string' || typeof discovery.pid !== 'number') {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery is missing required fields.')
  }
  if (!/^[0-9a-f]{64}$/i.test(discovery.token) || !Number.isInteger(discovery.pid) || discovery.pid <= 0) {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery credentials are invalid.')
  }

  let url: URL
  try {
    url = new URL(discovery.base_url)
  } catch {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC base URL is invalid.')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC must use an ephemeral 127.0.0.1 HTTP endpoint.')
  }
  return discovery as AgentDiscovery
}
