export {}

declare global {
  type DesktopInfo = { version: string; platform: string; arch: string }
  type DesktopStartup = { start_at_login: boolean }

  type AgentHello = {
    discovery_version: number
    protocol_min: number
    protocol_max: number
    agent_version: string
    pid: number
    platform: string
    arch: string
    capabilities: string[]
  }

  type AgentStatus = {
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

  type AgentConnectionState = {
    connected: boolean
    hello?: AgentHello
    status?: AgentStatus
    error?: string
  }

  type AgentSettings = {
    mount_path: string
    cache_limit_bytes: number
    sync_rules: Array<{ path: string; mode: string }>
  }

  type AgentFileAvailability = {
    Path: string
    Mode: string
    Placeholder: boolean
    Pinned: boolean
    OnlineOnly: boolean
    AvailableOffline: boolean
    InSync: boolean
    Syncing: boolean
  }

  type AgentTransfer = {
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

  type AgentTransfers = {
    revision: number
    transfers: AgentTransfer[]
  }

  type AgentStorageTreeNode = {
    path: string
    name: string
    mode: 'default' | 'exclude' | 'always-local'
    effective_mode: 'default' | 'exclude' | 'always-local'
    file_count: number
    total_bytes: number
    children?: AgentStorageTreeNode[]
  }

  type AgentCacheStats = {
    supported: boolean
    reason?: string
    used_bytes: number
    limit_bytes: number
    reclaimable_bytes: number
    pinned_bytes: number
    cached_files: number
    reclaimable_files: number
    pinned_files: number
  }

  type AgentCacheReleaseResult = {
    stats: AgentCacheStats
    released_bytes: number
    released_files: number
    failed_files: number
  }

  type AgentDiagnosticCheck = {
    name: string
    status: 'PASS' | 'WARN' | 'FAIL'
    detail: string
  }

  type AgentDiagnosticReport = {
    generated_at: string
    platform: string
    arch: string
    checks: AgentDiagnosticCheck[]
    summary: { pass: number; warn: number; fail: number }
  }

  type AgentConflict = {
    id: string
    server?: string
    username?: string
    original_path: string
    conflict_path: string
    original_node_id?: number
    conflict_node_id?: number
    created_at: string
  }

  type DesktopError = {
    code: string
    message: string
    status?: number
  }

  type DesktopResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: DesktopError }

  interface Window {
    xdriveDesktop: {
      getInfo: () => Promise<DesktopInfo>
      getStartup: () => Promise<DesktopStartup>
      setStartup: (enabled: boolean) => Promise<DesktopResult<DesktopStartup>>
      selectDirectory: (defaultPath?: string) => Promise<string | null>
      hide: () => void
      quit: () => void
      agent: {
        getState: () => Promise<AgentConnectionState>
        getTransfers: () => Promise<AgentTransfers>
        getStorageTree: () => Promise<DesktopResult<AgentStorageTreeNode>>
        getCache: () => Promise<DesktopResult<AgentCacheStats>>
        releaseCache: () => Promise<DesktopResult<AgentCacheReleaseResult>>
        getDiagnostics: () => Promise<DesktopResult<AgentDiagnosticReport>>
        reconnect: () => Promise<DesktopResult<AgentStatus>>
        repairSyncRoot: () => Promise<DesktopResult<AgentStatus>>
        openLogs: () => Promise<DesktopResult<{ ok: boolean }>>
        exportDiagnostics: () => Promise<DesktopResult<{ saved: boolean }>>
        retry: () => Promise<AgentConnectionState>
        restart: () => Promise<DesktopResult<AgentConnectionState>>
        login: (input: { server: string; username: string; password: string; mount_path?: string }) => Promise<DesktopResult<AgentStatus>>
        logout: () => Promise<DesktopResult<AgentStatus>>
        changePassword: (input: { current_password: string; new_password: string }) => Promise<DesktopResult<AgentStatus>>
        setPaused: (paused: boolean) => Promise<DesktopResult<AgentStatus>>
        syncNow: () => Promise<DesktopResult<AgentStatus>>
        getSettings: () => Promise<DesktopResult<AgentSettings>>
        updateSettings: (input: { mount_path?: string; cache_limit_bytes?: number }) => Promise<DesktopResult<AgentSettings>>
        setSyncRule: (path: string, mode: 'exclude' | 'always-local' | 'default') => Promise<DesktopResult<AgentSettings>>
        getFileAvailability: (path: string) => Promise<DesktopResult<AgentFileAvailability>>
        setFileAvailability: (path: string, action: 'keep' | 'release' | 'online' | 'sync') => Promise<DesktopResult<AgentFileAvailability | { ok: boolean }>>
        getConflicts: () => Promise<DesktopResult<AgentConflict[]>>
        openConflict: (id: string, both?: boolean) => Promise<DesktopResult<{ ok: boolean }>>
        resolveConflict: (id: string, choice: 'server' | 'local') => Promise<DesktopResult<{ ok: boolean }>>
        retryTransfer: (id: string) => Promise<DesktopResult<AgentTransfers>>
        openFolder: () => Promise<DesktopResult<{ ok: boolean }>>
        onState: (callback: (state: AgentConnectionState) => void) => () => void
        onTransfers: (callback: (state: AgentTransfers) => void) => () => void
      }
    }
  }
}
