const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const storageStats = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')
const cloudStorage = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudStoragePage.tsx'), 'utf8')
const cloudStorageAdapter = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudStorageAdapter.ts'), 'utf8')
const storageInventory = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'StorageInventorySection.tsx'), 'utf8')
const storageDistribution = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'StorageDistributionChart.tsx'), 'utf8')
const sidebarStorage = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SidebarStorageSummary.tsx'), 'utf8')
const metricCards = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'MetricCards.tsx'), 'utf8')
const sectionHeader = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SectionHeader.tsx'), 'utf8')
const localStorage = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopLocalStoragePage.tsx'), 'utf8')
const desktopApp = [
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopDiagnosticsPage.tsx'), 'utf8'),
  localStorage,
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopSettingsContent.tsx'), 'utf8'),
].join('\n')
const webApp = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const desktopStyles = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Web global storage statistics use shared metric primitives', () => {
  assert.equal((storageStats.match(/<XDriveMetricGrid\b/g) || []).length, 4)
  assert.equal((storageStats.match(/<XDriveMetricCard\b/g) || []).length, 28)
  assert.equal((storageStats.match(/<XDriveSectionHeader\b/g) || []).length, 11)
  assert.equal(storageStats.includes('function StorageStatGrid'), false)
  assert.equal(storageStats.includes('function StorageStat('), false)
  assert.equal(storageStats.includes('function SectionTitle'), false)
  assert.ok(metricCards.includes("gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }"))
  assert.equal(metricCards.includes('XDriveSectionHeading'), false)
  assert.ok(sectionHeader.includes('component={level}'))
  assert.ok(sectionHeader.includes("level === 'h3'"))
})

test('Cloud storage is one shared Web/Desktop current-account workspace', () => {
  assert.ok(cloudStorage.includes('export function XDriveCloudStoragePage'))
  assert.ok(cloudStorage.includes('title="云端存储"'))
  assert.equal((cloudStorage.match(/<XDriveMetricGrid\b/g) || []).length, 2)
  assert.equal((cloudStorage.match(/<XDriveMetricCard\b/g) || []).length, 11)
  assert.ok(cloudStorage.includes('title="范围：当前账号"'))
  assert.ok(cloudStorage.includes('title="账号容量"'))
  assert.ok(cloudStorage.includes('title="文件大小分布"'))
  assert.ok(cloudStorage.includes('<XDriveStorageDistributionChart'))
  assert.equal(cloudStorage.includes('CAS 全局物理对象'), false)
  assert.equal(cloudStorage.includes('宿主机绝对路径'), false)
  assert.equal(cloudStorage.includes('cleanupCache'), false)
  assert.ok(webApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'))
  assert.ok(desktopApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'))
  assert.ok(cloudStorageAdapter.includes('export function createXDriveCloudStorageDataSource'))
  assert.ok(cloudStorageAdapter.includes('resolveXDriveTransport'))
  assert.ok(cloudStorageAdapter.includes('tolerateStatsError = false'))
  assert.ok(cloudStorageAdapter.includes('onQuota?.(quota)'))
  assert.equal(cloudStorageAdapter.includes('cleanupCache'), false)
  assert.ok(webApp.includes('createXDriveCloudStorageDataSource({'))
  assert.ok(webApp.includes('tolerateStatsError: true'))
  assert.ok(desktopApp.includes('createXDriveCloudStorageDataSource({'))
  assert.ok(desktopApp.includes('getStats: storageStatsSupported'))
  assert.equal(webApp.includes('api.storageStats().catch(() => null)'), false)
  assert.equal(desktopApp.includes('if (!quotaResult.ok) throw new Error(quotaResult.error.message)'), false)
  assert.equal(webApp.includes('scope="self"'), false, 'Web must not keep a second account-storage presentation')
})

test('Global storage owns physical CAS distribution, inventory and cache cleanup', () => {
  for (const token of [
    'title="范围：全实例"',
    'title="CAS 全局物理对象"',
    'title="CAS Blob 尺寸分布"',
    'title="未引用 Blob"',
    '<XDriveStorageDistributionChart',
    '<XDriveStorageInventorySection',
    'api.adminCleanupStorageCache(kind)',
  ]) assert.ok(storageStats.includes(token), 'global storage contract missing: ' + token)
  assert.ok(storageInventory.includes('title="物理存储组成与缓存"'))
  assert.ok(storageInventory.includes('清理全部可回收缓存'))
  assert.ok(storageDistribution.includes("value: XDriveStorageDistributionValue"))
})

test('Local storage is a Desktop-only page and reuses shared metric primitives', () => {
  assert.ok(localStorage.includes('export function DesktopLocalStoragePage'))
  assert.ok(localStorage.includes('title="本地存储"'))
  assert.equal((localStorage.match(/<XDriveMetricGrid\b/g) || []).length, 1)
  assert.equal((localStorage.match(/<XDriveMetricCard\b/g) || []).length, 4)
  assert.equal(webApp.includes('LocalStoragePage'), false)
  assert.equal(webApp.includes('localStorageSource'), false)
  assert.ok(desktopApp.includes('<DesktopLocalStoragePage source={localStorageSource} />'))
  assert.equal((desktopApp.match(/<XDriveMetricGrid\b/g) || []).length, 2, 'diagnostics must not add another metric grid')
  assert.equal((desktopApp.match(/<XDriveMetricCard\b/g) || []).length, 12, 'diagnostics must not add pass/warn/fail metric cards')
  assert.equal(desktopApp.includes('className="cloud-quota-grid"'), false)
  assert.equal(desktopApp.includes('className="cache-metrics"'), false)
  assert.equal(desktopApp.includes('className="update-metrics"'), false)
  assert.equal(desktopStyles.includes('.cloud-quota-grid'), false)
  assert.equal(desktopStyles.includes('.cache-metrics'), false)
  assert.equal(desktopStyles.includes('.update-metrics'), false)
  assert.equal(desktopApp.includes('className="diagnostic-summary"'), false)
  assert.equal(desktopStyles.includes('.diagnostic-summary'), false)
  assert.equal(desktopStyles.includes('.diagnostic-count'), false)
  assert.equal(desktopStyles.includes('.diagnostic-generated'), false)
  assert.ok(desktopApp.includes('tone="good"'))
  assert.ok(desktopApp.includes('tone="warning"'))
  assert.ok(desktopApp.includes('tone="bad"'))
  assert.ok(metricCards.includes('tone?: XDriveStatusTone'))
  assert.ok(metricCards.includes('metricValueColor(tone)'))
})


test('unlimited cloud storage distinguishes xDrive bytes from other disk usage', () => {
  for (const token of [
    'data-xdrive-storage-breakdown',
    'data-xdrive-storage-segment="mine"',
    'data-xdrive-storage-segment="other"',
    "bgcolor: 'primary.main'",
    "bgcolor: 'secondary.main'",
    'otherDiskUsedBytes',
    '其他占用',
  ]) assert.ok(sidebarStorage.includes(token), 'storage usage color contract missing: ' + token)
  assert.ok(
    sidebarStorage.includes('Math.max(0, diskUsedBytes - xdriveDiskUsedBytes)'),
    'other disk usage must exclude current xDrive storage',
  )
})


test('global storage exposes paged legacy and pending-GC diagnostics on demand', () => {
  for (const token of [
    '待 GC Blob 明细',
    'Legacy 对象明细',
    'adminStorageUnreferencedBlobs',
    'adminStorageLegacyObjects',
    'reused_upload_parts',
    'current_file_refs',
    'history_version_refs',
    '不会重新扫描全部 Blob',
  ]) assert.ok(storageStats.includes(token), 'storage object diagnostics missing: ' + token)
})

test('global storage page reads daily physical snapshot without scanning staging on mount', () => {
  assert.match(storageStats, /physical_snapshot_at/)
  assert.match(storageStats, /每日后台任务更新/)
  assert.match(storageStats, /加载 staging 明细/)
  assert.equal(
    storageStats.includes("const stagingRequest = scope === 'global'"),
    false,
    'opening global storage must not trigger a staging filesystem scan',
  )
})


test('global storage delegates durable maintenance to the global Task Center', () => {
  for (const token of [
    'title="维护与修复"',
    '运行存储完整性校验',
    '运行存储修复',
    '查看维护任务',
    "runStorageMaintenance('storage_verify')",
    "runStorageMaintenance('storage_repair')",
    'legacy 对象到 CAS',
    'CAS 物理删除仍由 Janitor 负责',
  ]) assert.ok(storageStats.includes(token), 'storage maintenance handoff missing: ' + token)

  for (const token of [
    "taskCenter.pageProps.onBackgroundScopeChange?.('global')",
    "setAppView('transfers')",
    "api.controlBackgroundTask(\`system-maintenance:\${kind}\`, 'run', true)",
    'onOpenTaskCenter={openGlobalTaskCenter}',
    'onRunStorageMaintenance={runStorageMaintenance}',
  ]) assert.ok(webApp.includes(token), 'Web Task Center handoff missing: ' + token)
})


test('global storage history exposes persisted anomaly and cache trends without rescanning', () => {
  for (const token of [
    'title="异常与缓存趋势"',
    'aria-label="存储异常与缓存趋势"',
    '未引用 Blob',
    'Legacy',
    'Staging orphan / 可回收',
    '图片缩略图',
    '视频 Poster',
    '分析预览',
    '其他媒体 / Preview / 转码',
    '存储临时文件',
    '未分类',
    'anomaly_snapshot_available',
    'media_thumbnail_bytes',
    'video_poster_bytes',
    'analysis_preview_bytes',
    'preview_cache_bytes',
    'video_transcode_bytes',
    'storage_temp_bytes',
    'unclassified_bytes',
    '不会为了历史页面重新扫描',
  ]) assert.ok(storageStats.includes(token), 'storage anomaly history missing: ' + token)
})
