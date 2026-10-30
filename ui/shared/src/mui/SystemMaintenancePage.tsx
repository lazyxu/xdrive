import { useState } from 'react'
import type { XDriveServerBackupPort } from '../server-backup-admin'
import { XDriveServerBackupManagementPanel } from './ServerBackupManagementPanel'
import { XDriveBackupScheduleControl } from './BackupScheduleControl'
import { XDriveActionButton } from './ActionButton'
import { XDriveSectionHeader } from './SectionHeader'
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
  backupPort,
  onOpenStorage,
}: {
  updatePort: XDriveServerUpdatePort
  backupPort?: XDriveServerBackupPort
  onOpenStorage?: () => void
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
        <XDriveStatusAlert tone="warning" title="恢复前必须另行保管部署配置与密钥">
          服务器备份包含数据库与文件快照，但不代表已备份宿主机部署配置、
          加密密钥及证书材料。请将必要的配置和密钥安全地异地保存，并在隔离环境
          验证可读取、可恢复；不要在管理员网页中上传或展示这些密钥。
        </XDriveStatusAlert>
        {backupPort ? (
          <>
            <XDriveServerBackupManagementPanel port={backupPort} onOpenStorage={onOpenStorage} />
            <XDriveBackupScheduleControl port={backupPort} />
          </>
        ) : (
          <Stack spacing={1.5} data-xdrive-admin-backup-host-unavailable>
            <XDriveSectionHeader
              level="h3"
              title="服务器备份、恢复与备份仓库校验"
              subtitle="此处仅管理服务器备份；在线 CAS 数据完整性校验位于全局存储。"
            />
            <XDriveStatusAlert tone="warning">
              当前宿主未提供已认证的服务器备份管理能力（admin-backups）。
              因此无法在此创建、查询、修改策略、删除、恢复或校验服务器备份。
              请检查 Host Control / Agent 版本与能力；不会绕过宿主权限直接访问备份目录。
            </XDriveStatusAlert>
            {onOpenStorage ? (
              <XDriveActionButton onClick={onOpenStorage}>
                前往全局存储完整性校验（不等同于备份校验）
              </XDriveActionButton>
            ) : null}
          </Stack>
        )}
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
