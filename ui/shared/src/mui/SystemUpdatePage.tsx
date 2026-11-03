import { useState } from 'react'
import type { ReactNode } from 'react'
import { Stack, Typography } from '@mui/material'
import type { BuildInfo } from '../models'
import {
  xDriveServerUpdateConfirmationDescription,
  type XDriveServerUpdateChannel,
} from '../server-update'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveBuildInfoCard } from './BuildInfoCard'
import { XDriveServerUpdateCard } from './ServerUpdateCard'
import { useXDriveServerUpdateController, type XDriveServerUpdatePort } from './ServerUpdateController'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

/** One authenticated Host update workflow for Web and Desktop. */
export function XDriveSystemUpdatePage({
  updatePort,
  buildInfo = [],
  clientUpdateContent,
  supported = true,
  disabled = false,
  initialChannel = 'stable',
  unavailableLabel = '服务',
  unsupportedMessage = '当前客户端不支持服务端更新。',
  onBusyChange,
}: {
  updatePort: XDriveServerUpdatePort
  buildInfo?: { title: string; info?: BuildInfo | null }[]
  clientUpdateContent?: ReactNode
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
  const actionDisabled = disabled || update.busy ||
    update.state === null || update.state.supported === false

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="系统更新"
      subtitle="查看真实构建版本，并通过与命令行一致的宿主机事务更新服务端。"
    >
      <Stack spacing={2.5} data-xdrive-admin-system-update>
        {buildInfo.length > 0 ? (
          <Stack spacing={1}>
            <Typography variant="subtitle1" fontWeight={700}>已安装版本</Typography>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
              {buildInfo.map((item) => (
                <XDriveBuildInfoCard key={item.title} title={item.title} info={item.info} />
              ))}
            </Stack>
          </Stack>
        ) : null}
        <XDriveStatusAlert tone="neutral">
          服务端更新由宿主机后台执行，离开此页面不会取消更新任务。
          再次打开页面会读取当前真实状态。当前来源和通道不代表已经检查到更新。
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
        {clientUpdateContent}
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
