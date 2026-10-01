import type { ReactNode } from 'react'
import { Box as MuiBox } from '@mui/material'
import {
  XDriveActionButton,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveStatePanel,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import { formatBinarySize } from '@xdrive/shared'

export function DesktopStoragePage({
  storagePoliciesSupported,
  busy,
  cloudQuota,
  cloudStorageStats,
  cacheStats,
  storageTree,
  renderStorageNode,
  onRefresh,
  onReleaseCache,
}: {
  storagePoliciesSupported: boolean
  busy: string
  cloudQuota: AgentCloudQuota | null
  cloudStorageStats: AgentCloudStorageStats | null
  cacheStats: AgentCacheStats | null
  storageTree: AgentStorageTreeNode | null
  renderStorageNode: (node: AgentStorageTreeNode) => ReactNode
  onRefresh: () => void
  onReleaseCache: () => void
}) {
  return (
    <section className="panel storage-panel">
      <XDriveSectionHeader
        eyebrow="存储策略"
        title={storagePoliciesSupported ? '选择此设备保留的内容' : 'Linux FUSE 挂载'}
        subtitle={
          storagePoliciesSupported
            ? '策略应用于云端文件夹。“默认”继承最近的父级策略；“不同步”会从此设备移除该文件夹；“始终保留”会将已同步内容固定保存在本地。'
            : 'Linux 当前使用 FUSE 远程挂载；目录在此处只读展示，文件内容在打开时按需获取。'
        }
        actions={(
          <XDriveActionButton
            disabled={Boolean(busy)}
            loading={busy === 'storage'}
            loadingLabel="正在刷新…"
            onClick={onRefresh}
          >
            刷新
          </XDriveActionButton>
        )}
      />

      {cloudQuota ? (
        <div className="cloud-subpanel">
          <div className="cloud-subpanel-heading">
            <div>
              <strong>云端容量</strong>
              <span>当前账号的有效内容、回收站与历史版本占用</span>
            </div>
          </div>
          <MuiBox sx={{ p: 1.5 }}>
            <XDriveMetricGrid>
              <XDriveMetricCard
                title="物理占用"
                value={formatBinarySize(cloudQuota.physical_used_bytes)}
                suffix={cloudQuota.quota_bytes > 0 ? `配额 ${formatBinarySize(cloudQuota.quota_bytes)}` : '不限配额'}
              />
              <XDriveMetricCard
                title="可用空间"
                value={formatBinarySize(cloudQuota.available_bytes)}
                suffix={cloudQuota.quota_bytes > 0 ? '用户配额限制' : '服务器磁盘可用'}
              />
              <XDriveMetricCard title="当前文件" value={formatBinarySize(cloudQuota.logical_file_bytes)} suffix="有效逻辑内容" />
              <XDriveMetricCard title="回收站" value={formatBinarySize(cloudQuota.trash_bytes)} suffix="计入物理配额" />
              <XDriveMetricCard title="历史版本" value={formatBinarySize(cloudQuota.history_bytes)} suffix="已保存的历史内容" />
            </XDriveMetricGrid>
          </MuiBox>
        </div>
      ) : null}

      {cloudStorageStats ? (
        <div className="cloud-subpanel storage-intelligence">
          <div className="cloud-subpanel-heading">
            <div>
              <strong>CAS 存储情报</strong>
              <span>用于评估 CDC 与 small-file packing 的真实收益</span>
            </div>
          </div>
          <MuiBox sx={{ p: 1.5 }}>
            <XDriveMetricGrid>
              <XDriveMetricCard title="CAS Blob" value={cloudStorageStats.cas_blob_count.toLocaleString()} suffix="唯一物理对象" />
              <XDriveMetricCard title="CAS 物理容量" value={formatBinarySize(cloudStorageStats.cas_physical_bytes)} suffix="实际占用" />
              <XDriveMetricCard title="逻辑引用容量" value={formatBinarySize(cloudStorageStats.cas_logical_referenced_bytes)} suffix="含重复引用" />
              <XDriveMetricCard
                title="去重节省"
                value={formatBinarySize(cloudStorageStats.cas_dedup_saved_bytes)}
                suffix={`${cloudStorageStats.cas_dedup_ratio.toFixed(2)}× · ${(cloudStorageStats.cas_savings_ratio * 100).toFixed(1)}%`}
              />
              <XDriveMetricCard title="平均 Blob" value={formatBinarySize(cloudStorageStats.average_blob_size_bytes)} suffix="算术平均" />
              <XDriveMetricCard title="P50" value={formatBinarySize(cloudStorageStats.p50_blob_size_bytes)} suffix="中位尺寸" />
              <XDriveMetricCard title="P90" value={formatBinarySize(cloudStorageStats.p90_blob_size_bytes)} suffix="90% Blob 不超过" />
              <XDriveMetricCard title="P99" value={formatBinarySize(cloudStorageStats.p99_blob_size_bytes)} suffix="99% Blob 不超过" />
            </XDriveMetricGrid>
          </MuiBox>
          <div className="cloud-compact-list">
            {cloudStorageStats.buckets.map((bucket) => (
              <div className="cloud-compact-row" key={bucket.key}>
                <div><strong>{bucket.label}</strong><span>{bucket.count.toLocaleString()} 个 Blob</span></div>
                <strong>{formatBinarySize(bucket.bytes)}</strong>
              </div>
            ))}
          </div>
          {cloudStorageStats.legacy_blob_count > 0 ? (
            <XDriveStatusAlert tone="warning" sx={{ m: 1.5 }}>
              仍有 {cloudStorageStats.legacy_blob_count.toLocaleString()} 个 legacy 对象（{formatBinarySize(cloudStorageStats.legacy_physical_bytes)}），未计入 CAS 分布。
            </XDriveStatusAlert>
          ) : null}
        </div>
      ) : null}

      {!storagePoliciesSupported ? (
        <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
          Linux FUSE 模式不提供 Windows CfAPI 的“不同步”“始终保留”或持久化本地缓存语义；这些策略只在 Windows 客户端可配置。
        </XDriveStatusAlert>
      ) : null}

      {storagePoliciesSupported ? (
        cacheStats ? (
          <div className="cache-card">
            <MuiBox sx={{ p: 1.5 }}>
              <XDriveMetricGrid>
                <XDriveMetricCard title="已使用" value={formatBinarySize(cacheStats.used_bytes)} suffix={`${cacheStats.cached_files} 个缓存文件`} />
                <XDriveMetricCard title="上限" value={cacheStats.limit_bytes > 0 ? formatBinarySize(cacheStats.limit_bytes) : '不限'} suffix="固定内容受保护" />
                <XDriveMetricCard title="可释放" value={formatBinarySize(cacheStats.reclaimable_bytes)} suffix={`${cacheStats.reclaimable_files} 个文件`} />
                <XDriveMetricCard title="已固定" value={formatBinarySize(cacheStats.pinned_bytes)} suffix={`${cacheStats.pinned_files} 个文件`} />
              </XDriveMetricGrid>
            </MuiBox>
            {cacheStats.supported ? (
              <div className="cache-actions">
                <p>只会释放已完整同步且未固定的云端文件。“始终保留”的内容永远不会被回收。</p>
                <XDriveActionButton
                  disabled={Boolean(busy) || cacheStats.reclaimable_bytes <= 0}
                  loading={busy === 'release-cache'}
                  loadingLabel="正在释放…"
                  onClick={onReleaseCache}
                >
                  释放可回收缓存
                </XDriveActionButton>
              </div>
            ) : (
              <XDriveStatePanel variant="plain" compact align="left" borderTop message={cacheStats.reason || '当前平台不支持持久化本地缓存管理。'} />
            )}
          </div>
        ) : <XDriveStatePanel loading message="正在加载缓存用量…" />
      ) : null}

      <div className="storage-tree-header">
        <div>
          <strong>云端文件夹</strong>
          <span>{storagePoliciesSupported ? '默认 / 不同步 / 始终保留' : '只读目录视图 · FUSE 按需访问'}</span>
        </div>
        {storageTree ? <span>{storageTree.file_count} 个文件 · {formatBinarySize(storageTree.total_bytes)}</span> : null}
      </div>
      {!storageTree ? (
        <XDriveStatePanel loading message="正在加载云端文件夹树…" />
      ) : (storageTree.children || []).length === 0 ? (
        <XDriveStatePanel message="暂无云端文件夹。" />
      ) : (
        <div className="storage-tree">{(storageTree.children || []).map((node) => renderStorageNode(node))}</div>
      )}
    </section>
  )
}
