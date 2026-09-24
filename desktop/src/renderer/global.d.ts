export {}

declare global {
  type DesktopInfo = { version: string; platform: string; arch: string }

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
      selectDirectory: (defaultPath?: string) => Promise<string | null>
      hide: () => void
      quit: () => void
      agent: {
        getState: () => Promise<AgentConnectionState>
        retry: () => Promise<AgentConnectionState>
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
        openFolder: () => Promise<DesktopResult<{ ok: boolean }>>
        onState: (callback: (state: AgentConnectionState) => void) => () => void
      }
    }
  }
}
