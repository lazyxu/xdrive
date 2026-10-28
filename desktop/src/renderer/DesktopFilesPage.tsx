import type { ComponentProps } from 'react'
import { XDriveFilesWorkspacePage } from '@xdrive/ui/mui'
import DesktopFileExplorer from './DesktopFileExplorer'
import {
  desktopShareDialogAdapter,
  desktopTrashDialogAdapter,
  desktopVersionHistoryDialogAdapter,
} from './fileDialogAdapters'

type ExplorerProps = Omit<
  ComponentProps<typeof DesktopFileExplorer>,
  'trashActive' | 'trashAdapter' | 'onCloseTrash' | 'onTrashChanged'
>

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
    <XDriveFilesWorkspacePage
      overQuota={Boolean(quota?.over_quota)}
      historyDialog={{
        node: historyNode,
        adapter: desktopVersionHistoryDialogAdapter,
        onClose: onCloseHistory,
        onError: onFileDialogError,
        onFeedback: onFileDialogFeedback,
        onRestored: onHistoryRestored,
      }}
      shareDialog={{
        adapter: desktopShareDialogAdapter,
        node: shareNode,
        onClose: onCloseShare,
        onError: onFileDialogError,
        expiryMode: 'days',
        listVariant: 'compact',
        showCloseAction: true,
      }}
    >
      <DesktopFileExplorer
        key={explorer.navigationSessionStorageKey}
        {...explorer}
        trashActive={trashOpen}
        trashAdapter={desktopTrashDialogAdapter}
        onCloseTrash={onCloseTrash}
        onTrashChanged={onTrashChanged}
      />
    </XDriveFilesWorkspacePage>
  )
}
