import {
  XDriveActionButton,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveStatePanel,
  XDriveStatusBadge,
} from '@xdrive/ui/mui'

export function DesktopDiagnosticsPage({
  diagnostics,
  busy,
  paused,
  onRun,
  onRestartAgent,
  onReconnect,
  onRepairSyncRoot,
  onOpenLogs,
  onExport,
}: {
  diagnostics: AgentDiagnosticReport | null
  busy: string
  paused: boolean
  onRun: () => void
  onRestartAgent: () => void
  onReconnect: () => void
  onRepairSyncRoot: () => void
  onOpenLogs: () => void
  onExport: () => void
}) {
  const disabled = Boolean(busy)

  return (
    <section className="panel diagnostics-panel">
      <XDriveSectionHeader
        eyebrow="诊断与自修复"
        title="客户端诊断"
        subtitle={<>Agent 会运行与 <code>xd doctor</code> 相同的脱敏检查。密钥、会话 ID 和用户目录路径不会暴露给渲染进程。</>}
        actions={(
          <XDriveActionButton
            intent="primary"
            disabled={disabled}
            loading={busy === 'diagnostics'}
            loadingLabel="正在检查…"
            onClick={onRun}
          >
            运行诊断
          </XDriveActionButton>
        )}
      />

      {diagnostics ? (
        <>
          <XDriveMetricGrid>
            <XDriveMetricCard title="通过" value={diagnostics.summary.pass} tone="good" />
            <XDriveMetricCard title="警告" value={diagnostics.summary.warn} tone="warning" />
            <XDriveMetricCard title="失败" value={diagnostics.summary.fail} tone="bad" />
            <XDriveMetricCard title="上次检查" value={new Date(diagnostics.generated_at).toLocaleString()} />
          </XDriveMetricGrid>

          <div className="diagnostic-actions">
            <XDriveActionButton
              disabled={disabled}
              loading={busy === 'restart-agent'}
              loadingLabel="正在重启 Agent…"
              onClick={onRestartAgent}
            >
              重启 Agent
            </XDriveActionButton>
            <XDriveActionButton
              disabled={disabled || paused}
              loading={busy === 'reconnect'}
              loadingLabel="正在重新连接…"
              onClick={onReconnect}
            >
              重新连接
            </XDriveActionButton>
            <XDriveActionButton
              disabled={disabled || paused}
              loading={busy === 'repair-sync-root'}
              loadingLabel="正在修复…"
              onClick={onRepairSyncRoot}
            >
              修复同步根目录
            </XDriveActionButton>
            <XDriveActionButton
              disabled={disabled}
              loading={busy === 'open-logs'}
              loadingLabel="正在打开…"
              onClick={onOpenLogs}
            >
              打开日志
            </XDriveActionButton>
            <XDriveActionButton
              disabled={disabled}
              loading={busy === 'export-diagnostics'}
              loadingLabel="正在导出…"
              onClick={onExport}
            >
              导出报告
            </XDriveActionButton>
          </div>

          <div className="diagnostic-list">
            {diagnostics.checks.map((check, index) => (
              <article className="diagnostic-row" key={`${check.name}:${index}`}>
                <XDriveStatusBadge
                  tone={check.status === 'PASS' ? 'good' : check.status === 'WARN' ? 'warning' : 'bad'}
                  label={check.status}
                />
                <div>
                  <strong>{check.name}</strong>
                  <p>{check.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <XDriveStatePanel message="运行诊断可检查服务器/TLS、登录与凭据存储、Agent/IPC、同步根目录、CfAPI/FUSE、缓存策略、版本兼容性和磁盘空间。" />
      )}
    </section>
  )
}
