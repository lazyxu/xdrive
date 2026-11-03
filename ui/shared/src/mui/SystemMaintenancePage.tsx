import type { XDriveServerBackupPort } from '../server-backup-admin'
import { XDriveServerBackupManagementPanel } from './ServerBackupManagementPanel'
import { XDriveBackupScheduleControl } from './BackupScheduleControl'
import { XDriveActionButton } from './ActionButton'
import { XDriveSectionHeader } from './SectionHeader'
import { Stack } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

/** Server backups and recovery only. Updates are owned by admin-update. */
export function XDriveSystemMaintenancePage({
  backupPort,
  onOpenStorage,
}: {
  backupPort?: XDriveServerBackupPort
  onOpenStorage?: () => void
}) {
  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="备份与恢复"
      subtitle="服务器备份、恢复、备份仓库校验与定时计划；系统更新请前往「系统更新」。"
    >
      <Stack spacing={2.5} data-xdrive-admin-system-maintenance>
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
    </XDriveWorkspaceSurface>
  )
}
