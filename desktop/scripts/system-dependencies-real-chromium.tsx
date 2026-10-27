// Real shipped shared MUI administrator page, mounted in a local-only browser fixture.
// No production API, user account, AK, Docker socket or privileged Host action.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { XDriveServiceDependenciesPage } from '../../ui/shared/src/mui/ServiceDependenciesPage'
import type { XDriveServiceDependenciesPort } from '../../ui/shared/src/mui/ServiceDependenciesPage'
import type {
  XDriveServiceDependency, XDriveServiceDependenciesSnapshot, XDrivePhotoAutoConfig,
  XDrivePhotoHostConfig, XDrivePhotoHostPreflight,
} from '../../ui/shared/src/service-dependencies'
import { XDRIVE_SYSTEM_DEPENDENCY_IDS } from '../../ui/shared/src/system-dependencies-navigation'

const checkedAt = '2026-10-25T00:00:00Z'
const names: Record<string, string> = {
  database: 'PostgreSQL A', storage: '文件存储', 'background-worker': '后台 Worker',
  caddy: 'Caddy / HTTPS 网关', 'media-worker': 'FFmpeg Media Worker',
  'photo-face': '人脸检测与人物聚类', 'photo-smart': '动物／物体识别与 OCR',
  'photo-semantic': '图片语义搜索', 'photo-creative': '照片创作处理',
  'baidu-map': '百度地图', geonames: 'GeoNames 离线地名',
}
const services: XDriveServiceDependency[] = XDRIVE_SYSTEM_DEPENDENCY_IDS.map((id, index) => ({
  id,
  group: index < 4 ? 'core' : index === 4 ? 'media' :
    index < 9 ? 'intelligence' : 'location',
  label: names[id],
  status: index === 0 ? 'ready' : id === 'photo-smart' ? 'unavailable' : 'unknown',
  detail: id === 'photo-smart' ? 'OCR 测试：执行器未就绪，禁止标记为已启用。' :
    '仅用于浏览器排版回归，不表示真实部署状态。',
  config_mode: index === 0 ? 'in-app' : 'deployment',
  apply_mode: index === 0 ? 'immediate' : 'not-available',
  configuration_state: index === 0 ? 'configured' : 'unknown',
  installation_state: index === 0 ? 'external' : 'unknown',
  health_state: index === 0 ? 'ready' : id === 'photo-smart' ? 'failed' : 'unknown',
  activation_state: index === 0 ? 'local-effective' : 'unknown',
  ...(id === 'photo-smart' ? {
    ocr_auto_state: 'unavailable' as const, ocr_reason: 'runner_unavailable' as const,
    automatic_policy_state: 'unknown' as const,
  } : {}),
}))
const kinds = { face: true, smart: true, semantic: true, person_cluster: true }
const policy: XDrivePhotoAutoConfig = {
  auto_enabled: true, effective_auto_enabled: true,
  kinds, effective_kinds: kinds, revision: 3, effective_revision: 3,
  editable: true, source: 'saved', apply_state: 'applied', requires_restart: false,
}
const photoHostConfig: XDrivePhotoHostConfig = {
  desired_enabled: false, revision: 2, source: 'saved',
  apply_state: 'pending', editable: false, apply_supported: false,
  requirement: 'Synthetic-only: host and model execution are not verified',
  host_observed: false, host_runtime_state: 'unknown',
}
const photoHostPreflight: XDrivePhotoHostPreflight = {
  checked_at: checkedAt, action: 'unset', desired_revision: 2,
  local_checks_complete: false, host_observed: false,
  host_control_observed: false, apply_supported: false,
  model_info_checks: [], checks: [],
}
const probe = {
  readsA: 0, readsB: 0, hostReads: 0, hostChecks: 0, failNext: false,
  swapServer: () => {},
  releaseB: () => {},
}
;(window as any).__xdriveSystemDependenciesFixture = probe
const sourceA: XDriveServiceDependenciesPort = {
  load: async (): Promise<XDriveServiceDependenciesSnapshot> => {
    probe.readsA += 1
    if (probe.failNext) {
      probe.failNext = false
      throw new Error('SYNTHETIC_SECRET_MUST_NEVER_RENDER')
    }
    return { checked_at: checkedAt, services }
  },
  loadPhotoHostConfig: async () => {
    probe.hostReads += 1
    return { ...photoHostConfig }
  },
  loadPhotoHostPreflight: async () => {
    probe.hostChecks += 1
    return { ...photoHostPreflight }
  },
  loadPhotoAutoConfig: async () => ({ ...policy }),
  loadPhotoAutoRevisions: async () => ({ items: [] }),
  // Only enables a local unsaved switch. No test requests this mutation.
  savePhotoAutoConfig: async () => { throw new Error('synthetic fixture must not mutate') },
}
const sourceB: XDriveServiceDependenciesPort = {
  load: () => {
    probe.readsB += 1
    return new Promise<XDriveServiceDependenciesSnapshot>((resolve) => {
      probe.releaseB = () => resolve({ checked_at: checkedAt, services: [] })
    })
  },
}
const fixtureTheme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
const theme = createTheme({ palette: { mode: fixtureTheme } })
function Fixture() {
  const [server, setServer] = useState<'A' | 'B'>('A')
  useEffect(() => { probe.swapServer = () => setServer('B') }, [])
  return <ThemeProvider theme={theme}>
    <CssBaseline />
    <main data-xdrive-real-admin-fixture data-xdrive-fixture-theme={fixtureTheme} style={{
      boxSizing: 'border-box', maxWidth: 1380, width: '100%', minWidth: 0,
      margin: '0 auto', padding: '12px',
    }}>
      <XDriveServiceDependenciesPage source={server === 'A' ? sourceA : sourceB} />
    </main>
  </ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
