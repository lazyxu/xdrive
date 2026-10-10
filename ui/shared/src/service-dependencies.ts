export type XDriveServiceDependencyState =
  | 'ready'
  | 'unavailable'
  | 'disabled'
  | 'unknown'
  | 'planned'

export type XDriveServiceDependencyGroup =
  | 'core'
  | 'media'
  | 'intelligence'
  | 'location'

export type XDriveServiceConfigMode = 'in-app' | 'deployment' | 'planned'
export type XDriveServiceApplyMode = 'immediate' | 'manual-reload' | 'controlled-restart' | 'not-available'

export type XDriveServiceDependency = {
  id: string
  group: XDriveServiceDependencyGroup
  label: string
  status: XDriveServiceDependencyState
  detail: string
  version?: string
  model?: string
  config_mode?: XDriveServiceConfigMode
  apply_mode?: XDriveServiceApplyMode
  config_hint?: string
}

export type XDriveServiceDependenciesSnapshot = {
  checked_at: string
  services: XDriveServiceDependency[]
}

export type XDriveGeoNamesConfig = {
  dataset_configured: boolean
  reload_supported: boolean
  source: 'environment' | 'saved'
  current_version: string
  max_distance_km: number
  effective_max_distance_km: number
  editable: boolean
  revision: number
  apply_state: 'applied' | 'pending' | 'unavailable'
  updated_at?: string
  requires_restart: boolean
}

export type XDriveGeoNamesRevision = {
  revision: number
  max_distance_km: number
  origin: 'environment' | 'saved' | 'rollback'
  created_at: string
}

export type XDriveGeoNamesRevisionPage = { items: XDriveGeoNamesRevision[] }

export type XDriveGeoNamesRollbackInput = {
  revision: number
  target_revision: number
}

export type XDriveGeoNamesUpdate = {
  revision: number
  max_distance_km: number
}
export type XDriveGeoNamesReloadResult = {
  applied: boolean
  changed: boolean
  previous_version: string
  current_version: string
  checked_at: string
}

export type XDriveBaiduMapAdminConfig = {
  enabled: boolean
  configured: boolean
  source: 'environment' | 'saved'
  editable: boolean
  requires_restart: boolean
  revision: number
  updated_at?: string
}

export type XDriveBaiduMapAKReveal = {
  field: 'ak'
  value: string
  expires_in_seconds: number
}

export type XDriveBaiduMapAdminUpdate = {
  enabled: boolean
  revision: number
  ak?: string
  clear_ak?: boolean
}
