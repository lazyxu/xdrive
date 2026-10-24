import { useEffect, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServiceDependency } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { xDriveDashboardAssessment, xDriveSystemDependencyOverviewSignals } from '../system-dependencies-overview'
import { XDrivePostgresPoolConfigPanel, type XDrivePostgresPoolPort } from './PostgresPoolConfigPanel'
import { XDriveSourceWorkerConfigPanel, type XDriveSourceWorkerPort } from './SourceWorkerConfigPanel'

type CoreID = 'database' | 'storage' | 'background-worker'
type CorePort = XDrivePostgresPoolPort & XDriveSourceWorkerPort

const checkScopes: Record<CoreID, string> = {
  database: '仅检查当前 Server 能否连接 PostgreSQL；不代表数据库读写、备份恢复或其他节点正常。',
  storage: '仅检查当前 Server 的存储后端是否就绪；不执行文件读写、迁移、恢复或清理。',
  'background-worker': '仅检查在线 Pull Worker 心跳；不代表同步任务成功或全部设备已生效。',
}

export function XDriveCoreDependencyDetail({
  source, service, checkedAt, activeTab, refreshing, hasUnsavedEdits,
  onRefreshStatus, onDirtyChange,
}: {
  source: CorePort
  service: XDriveServiceDependency
  checkedAt: string
  activeTab: XDriveSystemDependencyTab
  refreshing: boolean
  hasUnsavedEdits: boolean
  onRefreshStatus: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const coreID = service.id as CoreID // The fixed-service parent only mounts these three IDs.
  const [configRefreshID, setConfigRefreshID] = useState(0)
  const [editorBusy, setEditorBusy] = useState(false)
  const isStorage = service.id === 'storage'
  const hasConfig = !isStorage
  const controlsLocked = refreshing || hasUnsavedEdits || editorBusy
  const assessment = xDriveDashboardAssessment(service)
  const signals = xDriveSystemDependencyOverviewSignals(service)
  // A legacy ready flag is not proof of health or runtime activation.
  const health = service.health_state === 'ready' ? '检查通过'
    : service.health_state === 'failed' ? '检查异常'
      : service.health_state === 'not-checked' ? '尚未检测' : '无法确认'

  const refreshAll = () => {
    // No form remount, new writes or speculative retry of a lost Save ACK.
    // In particular, never replace a draft or in-flight revision with a GET.
    if (controlsLocked) return
    if (hasConfig) setConfigRefreshID((id) => id + 1)
    onRefreshStatus()
  }

  useEffect(() => {
    if (activeTab === 'status') return
    const anchor = activeTab === 'verify' ? 'verify'
      : activeTab === 'config' ? 'config' : 'history'
    document.getElementById(`dependency-${service.id}-${anchor}-header`)
      ?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [activeTab, service.id, editorBusy])

  return (
    <Box data-xdrive-core-dependency-flat={service.id}
      sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
      <Paper id={`dependency-${service.id}-status-header`} variant="outlined"
        sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2, scrollMarginTop: 72 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between"
            gap={1} flexWrap="wrap">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700}
                color={assessment.state === 'failed' ? 'error.main' :
                  assessment.state === 'healthy' ? 'success.main' : 'text.primary'}
                data-xdrive-core-primary-state={service.id}>
                {assessment.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {checkedAt ? `检测时间：${checkedAt}` : '尚无检测时间'}
              </Typography>
            </Box>
            <Button variant="outlined" size="small" disabled={controlsLocked}
              onClick={refreshAll} data-xdrive-core-refresh={service.id}
              aria-busy={refreshing || undefined}>
              重新检测
            </Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }}
            data-xdrive-core-status-signals={service.id}>
            <Typography variant="body2">
              健康：{health}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {signals[1].label}：{signals[1].value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {signals[3].label}：{signals[3].value}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary"
            id={`dependency-${service.id}-verify-header`}
            data-xdrive-core-readonly-scope={service.id}
            sx={{ scrollMarginTop: 72 }}>
            {checkScopes[coreID]}
          </Typography>
          {assessment.state !== 'healthy' && service.detail && (
            <Typography variant="body2" color={assessment.state === 'failed' ? 'error.main' : 'text.secondary'}
              data-xdrive-core-status-reason={service.id}>
              {service.detail}
            </Typography>
          )}
          {hasUnsavedEdits && (
            <Typography variant="caption" color="text.secondary">
              有未保存修改，请先保存或放弃后重新检测。
            </Typography>
          )}
        </Stack>
      </Paper>
      {hasConfig && (
        <Box id={`dependency-${service.id}-config-header`}
          sx={{ scrollMarginTop: 72 }} data-xdrive-core-config={service.id}>
          {service.id === 'database' ? (
            <XDrivePostgresPoolConfigPanel source={source} refreshID={configRefreshID}
              section="all" singlePage onDirtyChange={onDirtyChange}
              onBusyChange={setEditorBusy} />
          ) : (
            <XDriveSourceWorkerConfigPanel source={source} refreshID={configRefreshID}
              section="all" singlePage onDirtyChange={onDirtyChange}
              onBusyChange={setEditorBusy} />
          )}
        </Box>
      )}
    </Box>
  )
}
