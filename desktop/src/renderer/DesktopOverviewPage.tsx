import {
  XDriveActionButton,
  XDriveDescriptionGrid,
  XDriveDescriptionItem,
  XDriveSectionHeader,
} from '@xdrive/ui/mui'

export function DesktopOverviewPage({
  status,
  hello,
  openFolderLoading,
  onOpenFolder,
}: {
  status?: AgentStatus
  hello?: AgentHello
  openFolderLoading: boolean
  onOpenFolder: () => void
}) {
  return (
    <>
      <section className="status-grid">
        <article className="status-card"><span className={`status-dot ${status?.paused ? 'waiting' : 'ready'}`} /><div><strong>同步</strong><p>{status?.sync_status}</p></div></article>
        <article className="status-card"><span className={`status-dot ${status?.has_conflict ? 'warning' : 'ready'}`} /><div><strong>冲突</strong><p>{status?.conflict_count || 0} 个未解决</p></div></article>
        <article className="status-card"><span className="status-dot ready" /><div><strong>Agent</strong><p>{status?.auth_status} · v{hello?.agent_version || status?.version} · IPC {hello?.protocol_min ?? '?'}-{hello?.protocol_max ?? '?'}</p></div></article>
        <article className="status-card"><span className="status-dot ready" /><div><strong>桌面桥接</strong><p>已通过受保护的本地 IPC 连接。</p></div></article>
      </section>

      <section className="system-card">
        <XDriveSectionHeader
          eyebrow="同步位置"
          title={status?.mount_path || '默认 xDrive 文件夹'}
          actions={(
            <XDriveActionButton
              loading={openFolderLoading}
              loadingLabel="正在打开…"
              onClick={onOpenFolder}
            >
              打开
            </XDriveActionButton>
          )}
        />
        <XDriveDescriptionGrid columns={4} sx={{ mt: 2.5 }}>
          <XDriveDescriptionItem label="服务器">{status?.server}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="用户">{status?.username}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="状态">{status?.paused ? '已暂停' : status?.sync_status}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="修订号">{status?.revision}</XDriveDescriptionItem>
        </XDriveDescriptionGrid>
      </section>
    </>
  )
}
