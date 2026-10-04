import type { ComponentProps } from 'react'
import {
  XDriveShareDialog,
  XDriveStatusAlert,
  XDriveTrashDialog,
  XDriveVersionHistoryDialog,
} from '@xdrive/ui/mui'
import DesktopFileExplorer from './DesktopFileExplorer'
import {
  desktopTrashDialogAdapter,
  desktopVersionHistoryDialogAdapter,
} from './fileDialogAdapters'
import { desktopShareDialogAdapter } from './shareDialogAdapter'

type ExplorerProps = ComponentProps<typeof DesktopFileExplorer>

export function DesktopFilesPage({
  quota,
  explorer,
  trashOpen,
  onCloseTrash,
  onTrashChanged,
  historyNode,
  onCloseHistory,
  onHistoryRestored,
  shareNode,
  onCloseShare,
  onFileDialogError,
  onFileDialogFeedback,
}: {
  quota: AgentCloudQuota | null
  explorer: ExplorerProps
  trashOpen: boolean
  onCloseTrash: () => void
  onTrashChanged: () => void | Promise<void>
  historyNode: AgentCloudNode | null
  onCloseHistory: () => void
  onHistoryRestored: (node: AgentCloudNode) => void | Promise<void>
  shareNode: AgentCloudNode | null
  onCloseShare: () => void
  onFileDialogError: (error: unknown) => void
  onFileDialogFeedback: (message: string) => void
}) {
  return (
    <section className="cloud-explorer-panel">
      {quota?.over_quota ? (
        <XDriveStatusAlert tone="bad" sx={{ m: 1.5 }}>
          存储空间已超出配额。请永久删除回收站内容，或联系管理员提高配额。
        </XDriveStatusAlert>
      ) : null}

      <DesktopFileExplorer {...explorer} />

      <XDriveTrashDialog
        open={trashOpen}
        adapter={desktopTrashDialogAdapter}
        onClose={onCloseTrash}
        onError={onFileDialogError}
        onFeedback={onFileDialogFeedback}
        onChanged={onTrashChanged}
      />

      <XDriveVersionHistoryDialog
        node={historyNode}
        adapter={desktopVersionHistoryDialogAdapter}
        onClose={onCloseHistory}
        onError={onFileDialogError}
        onFeedback={onFileDialogFeedback}
        onRestored={onHistoryRestored}
      />

      <XDriveShareDialog
        adapter={desktopShareDialogAdapter}
        node={shareNode}
        onClose={onCloseShare}
        onError={onFileDialogError}
        expiryMode="days"
        listVariant="compact"
        showCloseAction
      />
    </section>
  )
}
