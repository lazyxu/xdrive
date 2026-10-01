import { XDriveTransferCenter, XDriveWorkspaceSurface } from '@xdrive/ui/mui'

export function DesktopTransfersPage({
  transfers,
  retryingID,
  retryDisabled,
  onRetry,
}: {
  transfers: AgentTransfer[]
  retryingID: string
  retryDisabled: boolean
  onRetry: (id: string) => void
}) {
  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="传输"
      subtitle="查看上传、下载、本地可用性、实时进度、速度、已耗时与历史状态。"
    >
      <XDriveTransferCenter
        transfers={transfers}
        retryingID={retryingID}
        retryDisabled={retryDisabled}
        onRetry={onRetry}
      />
    </XDriveWorkspaceSurface>
  )
}
