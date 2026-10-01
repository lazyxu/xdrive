import {
  XDriveActionButton,
  XDriveSectionHeader,
  XDriveWorkspaceSurface,
  XDriveStatePanel,
} from '@xdrive/ui/mui'

export function DesktopConflictsPage({
  conflicts,
  busy,
  onRefresh,
  onOpenBoth,
  onKeepServer,
  onKeepLocal,
}: {
  conflicts: AgentConflict[]
  busy: boolean
  onRefresh: () => void
  onOpenBoth: (item: AgentConflict) => void
  onKeepServer: (item: AgentConflict) => void
  onKeepLocal: (item: AgentConflict) => void
}) {
  return (
    <XDriveWorkspaceSurface presentation="page" title="冲突">
      <XDriveSectionHeader
        eyebrow="冲突副本"
        title="解决同步冲突"
        actions={<XDriveActionButton disabled={busy} onClick={onRefresh}>刷新</XDriveActionButton>}
      />
      {conflicts.length === 0 ? <XDriveStatePanel message="没有未解决的冲突。" /> : (
        <div className="conflict-list">
          {conflicts.map((item) => (
            <article className="conflict-row" key={item.id}>
              <div className="conflict-copy">
                <strong>{item.original_path}</strong>
                <span>冲突副本：{item.conflict_path}</span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
              </div>
              <div className="row-actions">
                <XDriveActionButton compact onClick={() => onOpenBoth(item)}>同时打开</XDriveActionButton>
                <XDriveActionButton compact onClick={() => onKeepServer(item)}>保留服务器版本</XDriveActionButton>
                <XDriveActionButton compact intent="primary" onClick={() => onKeepLocal(item)}>保留本地版本</XDriveActionButton>
              </div>
            </article>
          ))}
        </div>
      )}
    </XDriveWorkspaceSurface>
  )
}
