import { useState } from 'react'
import { Stack } from '@mui/material'
import {
  xDriveServerUpdateConfirmationDescription,
  type XDriveServerUpdateChannel,
} from '../server-update'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveServerUpdateCard } from './ServerUpdateCard'
import { useXDriveServerUpdateController, type XDriveServerUpdatePort } from './ServerUpdateController'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

/**
 * Instance-level maintenance: never mount inside personal Settings.
 * The owning Web/Agent adapter keeps its privileged transport, and the Server
 * remains the source of authority for both role and durable host-update state.
 */
export function XDriveSystemMaintenancePage({
  updatePort,
  supported = true,
  disabled = false,
  initialChannel = 'stable',
  unavailableLabel = '服务',
  unsupportedMessage = '当前客户端不支持服务端更新。',
  onBusyChange,
}: {
  updatePort: XDriveServerUpdatePort
  supported?: boolean
  disabled?: boolean
  initialChannel?: XDriveServerUpdateChannel
  unavailableLabel?: string
  unsupportedMessage?: string
  onBusyChange?: (busy: boolean) => void
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const update = useXDriveServerUpdateController({
    open: true,
    supported,
    initialChannel,
    port: updatePort,
    unsupportedMessage,
    onBusyChange,
  })
  const actionDisabled = disabled || update.busy || update.state === null || update.state.supported === false

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="系统维护"
      subtitle="仅管理员可执行影响整个 xDrive 实例的维护；本机客户端更新与个人设置在这里不执行。"
    >
      <Stack spacing={2.5} data-xdrive-admin-system-maintenance>
        <XDriveStatusAlert tone="neutral">
          服务端更新由宿主机后台执行，离开此页面不会取消更新任务。再次打开页面会读取当前真实状态。
        </XDriveStatusAlert>
        <XDriveServerUpdateCard
          state={update.state}
          source={update.source}
          channel={update.channel}
          backupFileData={update.backupFileData}
          loading={update.busy}
          disabled={actionDisabled}
          onSourceChange={update.setSource}
          onChannelChange={update.setChannel}
          onBackupFileDataChange={update.setBackupFileData}
          onStart={() => { if (!actionDisabled) setConfirmationOpen(true) }}
        />
        {update.error ? <XDriveStatusAlert tone="warning">{update.error}</XDriveStatusAlert> : null}
      </Stack>
      <XDriveConfirmDialog
        open={confirmationOpen}
        title="确认更新服务端？"
        description={xDriveServerUpdateConfirmationDescription({
          source: update.source,
          channel: update.channel,
          backupFileData: update.backupFileData,
          unavailableLabel,
        })}
        confirmLabel="开始更新"
        confirmIntent="warning"
        loading={update.busy}
        loadingLabel="正在提交…"
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={() => {
          if (actionDisabled) return
          setConfirmationOpen(false)
          void update.start()
        }}
      />
    </XDriveWorkspaceSurface>
  )
}
