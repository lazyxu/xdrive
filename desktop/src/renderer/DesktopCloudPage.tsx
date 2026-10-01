import type { ComponentProps } from 'react'
import { Dialog } from '@mui/material'
import {
  XDriveActionButton,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveShareDialog,
  XDriveStatePanel,
  XDriveStatusAlert,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import { formatBinarySize } from '@xdrive/shared'
import DesktopFileExplorer from './DesktopFileExplorer'
import { desktopShareDialogAdapter } from './shareDialogAdapter'

type ExplorerProps = ComponentProps<typeof DesktopFileExplorer>

export function DesktopCloudPage({
  quota,
  explorer,
  busy,
  trashOpen,
  trash,
  onCloseTrash,
  onRestoreTrash,
  onDeleteTrash,
  historyNode,
  historyVersions,
  onCloseHistory,
  onRestoreHistory,
  shareNode,
  onCloseShare,
  onShareError,
}: {
  quota: AgentCloudQuota | null
  explorer: ExplorerProps
  busy: boolean
  trashOpen: boolean
  trash: AgentCloudNode[]
  onCloseTrash: () => void
  onRestoreTrash: (node: AgentCloudNode) => void
  onDeleteTrash: (node: AgentCloudNode) => void
  historyNode: AgentCloudNode | null
  historyVersions: AgentCloudVersion[]
  onCloseHistory: () => void
  onRestoreHistory: (version: AgentCloudVersion) => void
  shareNode: AgentCloudNode | null
  onCloseShare: () => void
  onShareError: (error: unknown) => void
}) {
  return (
    <section className="cloud-explorer-panel">
      {quota?.over_quota ? (
        <XDriveStatusAlert tone="bad" sx={{ m: 1.5 }}>
          存储空间已超出配额。请永久删除回收站内容，或联系管理员提高配额。
        </XDriveStatusAlert>
      ) : null}

      <DesktopFileExplorer {...explorer} />

      {trashOpen ? (
        <Dialog
          open={trashOpen}
          onClose={() => { if (!busy) onCloseTrash() }}
          maxWidth="md"
          fullWidth
          scroll="paper"
          aria-label="回收站"
          slotProps={{ paper: xDriveDialogPaperProps }}
        >
          <XDriveDialogTitle
            title="回收站"
            subtitle={`${trash.length} 个项目`}
            onClose={onCloseTrash}
            closeDisabled={busy}
          />
          <XDriveDialogContent dividers flush>
            {trash.length === 0 ? (
              <XDriveStatePanel variant="plain" compact message="回收站为空。" />
            ) : (
              <div className="cloud-compact-list">
                {trash.map((node) => (
                  <div className="cloud-compact-row" key={node.id}>
                    <div>
                      <strong>{node.name}</strong>
                      <span>
                        {node.type === 'dir' ? '文件夹' : formatBinarySize(node.size)}
                        {' · 删除于 '}
                        {node.deleted_at ? new Date(node.deleted_at).toLocaleString() : '—'}
                      </span>
                    </div>
                    <div className="cloud-row-actions">
                      <XDriveActionButton compact disabled={busy} onClick={() => onRestoreTrash(node)}>恢复</XDriveActionButton>
                      <XDriveActionButton compact intent="danger" disabled={busy} onClick={() => onDeleteTrash(node)}>永久删除</XDriveActionButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </XDriveDialogContent>
          <XDriveDialogActions>
            <XDriveActionButton disabled={busy} onClick={onCloseTrash}>关闭</XDriveActionButton>
          </XDriveDialogActions>
        </Dialog>
      ) : null}

      {historyNode ? (
        <Dialog
          open={Boolean(historyNode)}
          onClose={() => { if (!busy) onCloseHistory() }}
          maxWidth="md"
          fullWidth
          scroll="paper"
          aria-label="版本历史"
          slotProps={{ paper: xDriveDialogPaperProps }}
        >
          <XDriveDialogTitle
            title={`版本历史 — ${historyNode.name}`}
            subtitle={`当前版本 r${historyNode.revision}`}
            onClose={onCloseHistory}
            closeDisabled={busy}
          />
          <XDriveDialogContent dividers flush>
            {historyVersions.length === 0 ? (
              <XDriveStatePanel variant="plain" compact message="暂无历史版本。" />
            ) : (
              <div className="cloud-compact-list">
                {historyVersions.map((version) => (
                  <div className="cloud-compact-row" key={version.id}>
                    <div>
                      <strong>Revision r{version.revision}</strong>
                      <span>{formatBinarySize(version.size)} · {new Date(version.created_at).toLocaleString()}</span>
                    </div>
                    <XDriveActionButton compact intent="primary" disabled={busy} onClick={() => onRestoreHistory(version)}>
                      恢复
                    </XDriveActionButton>
                  </div>
                ))}
              </div>
            )}
          </XDriveDialogContent>
          <XDriveDialogActions>
            <XDriveActionButton disabled={busy} onClick={onCloseHistory}>关闭</XDriveActionButton>
          </XDriveDialogActions>
        </Dialog>
      ) : null}

      <XDriveShareDialog
        adapter={desktopShareDialogAdapter}
        node={shareNode}
        onClose={onCloseShare}
        onError={onShareError}
        expiryMode="days"
        listVariant="compact"
        showCloseAction
      />
    </section>
  )
}
