import { contextBridge, ipcRenderer } from 'electron'

const agent = Object.freeze({
  getState: () => ipcRenderer.invoke('agent:get-state'),
  getTransfers: () => ipcRenderer.invoke('agent:get-transfers'),
  getStorageTree: () => ipcRenderer.invoke('agent:get-storage-tree'),
  getCache: () => ipcRenderer.invoke('agent:get-cache'),
  releaseCache: () => ipcRenderer.invoke('agent:release-cache'),
  getSources: () => ipcRenderer.invoke('agent:get-sources'),
  getSourceRuns: (sourceID: number, limit = 1, offset = 0) => ipcRenderer.invoke('agent:get-source-runs', sourceID, limit, offset),
  getSourceRunFailures: (sourceID: number, runID: string, limit = 20, offset = 0) => ipcRenderer.invoke('agent:get-source-run-failures', sourceID, runID, limit, offset),
  cancelSourceRun: (sourceID: number, runID: string) => ipcRenderer.invoke('agent:cancel-source-run', sourceID, runID),
  getSourceItems: (sourceID: number, state = 'error', limit = 1000, offset = 0) => ipcRenderer.invoke('agent:get-source-items', sourceID, state, limit, offset),
  getSourceCollections: (sourceID: number, state = '') => ipcRenderer.invoke('agent:get-source-collections', sourceID, state),
  getSourceCollectionItems: (sourceID: number, collectionID: number, limit = 100, offset = 0) => ipcRenderer.invoke('agent:get-source-collection-items', sourceID, collectionID, limit, offset),
  getSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:get-source-credential', sourceID),
  testSourceCredential: (kind: string, credential: string | Record<string, string>) => ipcRenderer.invoke('agent:test-source-credential', kind, credential),
  testStoredSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:test-stored-source-credential', sourceID),
  setSourceCredential: (sourceID: number, credential: string | Record<string, string>) => ipcRenderer.invoke('agent:set-source-credential', sourceID, credential),
  deleteSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:delete-source-credential', sourceID),
  getSourceConnectorConfig: (sourceID: number) => ipcRenderer.invoke('agent:get-source-connector-config', sourceID),
  setSourceConnectorConfig: (sourceID: number, revision: number, payload: Record<string, unknown>) => ipcRenderer.invoke('agent:set-source-connector-config', sourceID, revision, payload),
  createSource: (input: {
    name: string
    kind: string
    direction: 'push' | 'pull'
    sync_mode: 'backup'
    run_mode: 'scan' | 'sync'
    schedule_type?: 'interval' | 'cron' | 'manual'
    schedule_expression?: string
    schedule_timezone?: string
    target_node_id: number
    ignore_rules?: string
  }) => ipcRenderer.invoke('agent:create-source', input),
  updateSource: (sourceID: number, revision: number, input: {
    name?: string
    run_mode?: 'scan' | 'sync'
    status?: 'active' | 'paused'
    schedule_type?: 'interval' | 'cron' | 'manual'
    schedule_expression?: string
    schedule_timezone?: string
    target_node_id?: number
    ignore_rules?: string
  }) => ipcRenderer.invoke('agent:update-source', sourceID, revision, input),
  deleteSource: (sourceID: number, revision: number) => ipcRenderer.invoke('agent:delete-source', sourceID, revision),
  triggerSource: (sourceID: number) => ipcRenderer.invoke('agent:trigger-source', sourceID),
  cloudRoot: () => ipcRenderer.invoke('agent:cloud-root'),
  cloudChildren: (parentID: number) => ipcRenderer.invoke('agent:cloud-children', parentID),
  cloudSearch: (query: string) => ipcRenderer.invoke('agent:cloud-search', query),
  cloudQuota: () => ipcRenderer.invoke('agent:cloud-quota'),
  cloudStorageStats: () => ipcRenderer.invoke('agent:cloud-storage-stats'),
  cloudTrash: () => ipcRenderer.invoke('agent:cloud-trash'),
  cloudRestoreTrash: (id: number, revision: number) => ipcRenderer.invoke('agent:cloud-restore-trash', id, revision),
  cloudDeleteTrash: (id: number, revision: number) => ipcRenderer.invoke('agent:cloud-delete-trash', id, revision),
  cloudVersions: (nodeID: number) => ipcRenderer.invoke('agent:cloud-versions', nodeID),
  cloudRestoreVersion: (nodeID: number, revision: number, versionID: number) =>
    ipcRenderer.invoke('agent:cloud-restore-version', nodeID, revision, versionID),
  cloudShares: (nodeID: number) => ipcRenderer.invoke('agent:cloud-shares', nodeID),
  cloudCreateShare: (nodeID: number, input: { expires_at?: string; password?: string; max_downloads?: number }) =>
    ipcRenderer.invoke('agent:cloud-create-share', nodeID, input),
  cloudRevokeShare: (id: number) => ipcRenderer.invoke('agent:cloud-revoke-share', id),
  getDiagnostics: () => ipcRenderer.invoke('agent:get-diagnostics'),
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
  repairSyncRoot: () => ipcRenderer.invoke('agent:repair-sync-root'),
  openLogs: () => ipcRenderer.invoke('agent:open-logs'),
  exportDiagnostics: () => ipcRenderer.invoke('agent:export-diagnostics'),
  retry: () => ipcRenderer.invoke('agent:retry'),
  restart: () => ipcRenderer.invoke('agent:restart'),
  login: (input: {
    server: string
    username: string
    password: string
    mount_path?: string
    remember_password?: boolean
    auto_login?: boolean
    use_saved_password?: boolean
  }) => ipcRenderer.invoke('agent:login', input),
  logout: () => ipcRenderer.invoke('agent:logout'),
  changePassword: (input: { current_password: string; new_password: string }) => ipcRenderer.invoke('agent:change-password', input),
  setPaused: (paused: boolean) => ipcRenderer.invoke('agent:set-paused', paused),
  syncNow: () => ipcRenderer.invoke('agent:sync-now'),
  getSettings: () => ipcRenderer.invoke('agent:get-settings'),
  updateSettings: (input: { mount_path?: string; cache_limit_bytes?: number }) => ipcRenderer.invoke('agent:update-settings', input),
  getUpdate: () => ipcRenderer.invoke('agent:get-update'),
  setUpdateMode: (mode: 'manual' | 'check' | 'download' | 'install') => ipcRenderer.invoke('agent:set-update-mode', mode),
  setUpdateSource: (source: 'github' | 'gitlab') => ipcRenderer.invoke('agent:set-update-source', source),
  checkUpdate: () => ipcRenderer.invoke('agent:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('agent:download-update'),
  installUpdate: () => ipcRenderer.invoke('agent:install-update'),
  cancelUpdate: () => ipcRenderer.invoke('agent:cancel-update'),
  setSyncRule: (path: string, mode: 'exclude' | 'always-local' | 'default') => ipcRenderer.invoke('agent:set-sync-rule', path, mode),
  getFileAvailability: (path: string) => ipcRenderer.invoke('agent:get-file-availability', path),
  setFileAvailability: (path: string, action: 'keep' | 'release' | 'online' | 'sync') =>
    ipcRenderer.invoke('agent:set-file-availability', path, action),
  getConflicts: () => ipcRenderer.invoke('agent:get-conflicts'),
  openConflict: (id: string, both = false) => ipcRenderer.invoke('agent:open-conflict', id, both),
  resolveConflict: (id: string, choice: 'server' | 'local') => ipcRenderer.invoke('agent:resolve-conflict', id, choice),
  retryTransfer: (id: string) => ipcRenderer.invoke('agent:retry-transfer', id),
  openFolder: () => ipcRenderer.invoke('agent:open-folder'),
  onState: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:state', handler)
    return () => ipcRenderer.removeListener('agent:state', handler)
  },
  onTransfers: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:transfers', handler)
    return () => ipcRenderer.removeListener('agent:transfers', handler)
  },
})

contextBridge.exposeInMainWorld('xdriveDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  getStartup: () => ipcRenderer.invoke('desktop:get-startup'),
  getPreferences: () => ipcRenderer.invoke('desktop:get-preferences'),
  getLoginHistory: () => ipcRenderer.invoke('desktop:get-login-history'),
  getWindowState: () => ipcRenderer.invoke('desktop:get-window-state'),
  minimizeWindow: () => ipcRenderer.send('desktop:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('desktop:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('desktop:window-close'),
  onWindowState: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('desktop:window-state', handler)
    return () => ipcRenderer.removeListener('desktop:window-state', handler)
  },
  setStartup: (enabled: boolean) => ipcRenderer.invoke('desktop:set-startup', enabled),
  setCloseToTray: (enabled: boolean) => ipcRenderer.invoke('desktop:set-close-to-tray', enabled),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('desktop:select-directory', defaultPath),
  openExternal: (url: string) => ipcRenderer.invoke('desktop:open-external', url),
  hide: () => ipcRenderer.send('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
  onNavigate: (callback: (view: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, view: string) => callback(view)
    ipcRenderer.on('desktop:navigate', handler)
    return () => ipcRenderer.removeListener('desktop:navigate', handler)
  },
  agent,
}))
