import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const readRepo = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

const files = {
  app: read('src/App.tsx'),
  users: read('src/AdminUsers.tsx'),
  audit: read('src/AdminAudit.tsx'),
  storageStats: read('src/StorageStatsPanel.tsx'),
  share: read('src/ShareDialog.tsx') + readRepo('ui/shared/src/mui/ShareDialog.tsx'),
  shareFields: readRepo('ui/shared/src/mui/ShareFields.tsx'),
  shareList: readRepo('ui/shared/src/mui/ShareList.tsx'),
  trashDialog: readRepo('ui/shared/src/mui/TrashDialog.tsx'),
  versionHistoryDialog: readRepo('ui/shared/src/mui/VersionHistoryDialog.tsx'),
  fileNameDialog: readRepo('ui/shared/src/mui/FileNameDialog.tsx'),
  publicShare: read('src/PublicShare.tsx'),
  sources: read('src/ExternalSources.tsx') + readRepo('ui/shared/src/mui/SourceManager.tsx'),
  workspaceSurface: readRepo('ui/shared/src/mui/WorkspaceSurface.tsx'),
  settingsDialog: readRepo('ui/shared/src/mui/SettingsDialog.tsx'),
  accountChrome: readRepo('ui/shared/src/mui/AccountChrome.tsx'),
  brandLockup: readRepo('ui/shared/src/mui/BrandLockup.tsx'),
  confirmDialog: readRepo('ui/shared/src/mui/ConfirmDialog.tsx'),
  metricCards: readRepo('ui/shared/src/mui/MetricCards.tsx'),
  sidebarStorageSummary: readRepo('ui/shared/src/mui/SidebarStorageSummary.tsx'),
  workspaceSidebar: readRepo('ui/shared/src/mui/WorkspaceSidebar.tsx'),
  descriptionGrid: readRepo('ui/shared/src/mui/DescriptionGrid.tsx'),
  sectionHeader: readRepo('ui/shared/src/mui/SectionHeader.tsx'),
  tableSurface: readRepo('ui/shared/src/mui/TableSurface.tsx'),
  externalSourcesShared: readRepo('ui/shared/src/external-sources.ts'),
  synologyGuide: readRepo('ui/shared/src/mui/SynologyDsmGuideDialog.tsx'),
  yikeCookieHelp: readRepo('ui/shared/src/mui/YikeCookieHelp.tsx'),
  sourceRunProgress: readRepo('ui/shared/src/mui/SourceRunProgress.tsx'),
  sourceFailureItem: readRepo('ui/shared/src/mui/SourceFailureItem.tsx'),
  paginationControls: readRepo('ui/shared/src/mui/PaginationControls.tsx'),
  sourceRunSummary: readRepo('ui/shared/src/mui/SourceRunSummary.tsx'),
  sourceCollection: readRepo('ui/shared/src/mui/SourceCollection.tsx'),
  sourceScheduleFields: readRepo('ui/shared/src/mui/SourceScheduleFields.tsx'),
  sourceBasicFields: readRepo('ui/shared/src/mui/SourceBasicFields.tsx'),
  sourceCredentialFields: readRepo('ui/shared/src/mui/SourceCredentialFields.tsx'),
  sourceConnectorConfigFields: readRepo('ui/shared/src/mui/SourceConnectorConfigFields.tsx'),
  sourceIgnoreRulesField: readRepo('ui/shared/src/mui/SourceIgnoreRulesField.tsx'),
  main: read('src/main.tsx'),
  styles: read('src/styles.css'),
  packageJson: read('package.json'),
  packageLock: read('package-lock.json'),
  html: read('index.html'),
}

const requireText = (source, values, label) => {
  for (const value of values) {
    if (!source.includes(value)) throw new Error(`${label} 缺少中文 GUI 文案：${value}`)
  }
}

const forbidText = (source, values, label) => {
  for (const value of values) {
    if (source.includes(value)) throw new Error(`${label} 出现已禁止的英文 GUI 文案：${value}`)
  }
}

requireText(files.app + files.trashDialog + files.versionHistoryDialog + files.fileNameDialog, ['登录', '我的文件', '回收站', '新建文件夹', '版本历史', 'XDriveStatusAlert'], '文件管理器')
if (/from ['"]antd['"]/.test(files.app) || files.app.includes('@ant-design/icons')) throw new Error('Web 主文件管理器仍依赖 Ant Design')
requireText(files.app + files.trashDialog + files.versionHistoryDialog + files.fileNameDialog, ['XDriveActionButton', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveDialogActions', 'XDriveConfirmDialog', 'XDriveStatePanel', 'XDriveMediaGalleryPage'], 'Web MUI 文件管理器')
requireText(files.confirmDialog, ['XDriveConfirmDialog', 'aria-label="确认操作"', 'closeDisabled={loading}', 'XDriveActionButton'], '共享确认框')
requireText(files.app, ['XDriveConfirmDialog', 'confirmIntent={confirmAction?.intent', 'loading={confirmBusy}'], 'Web 确认框')
if (/<Alert\b/.test(files.app)) throw new Error('Web 主界面仍在直接渲染 AntD Alert')
requireText(files.app, ['XDriveBrandLockup', 'iconSrc={xDriveBrandIcon}'], 'xDrive 品牌图标')
requireText(files.brandLockup, ['XDriveBrandLockup', "variant === 'titlebar'", "variant === 'large'", 'component="img"', 'xDrive'], '共享品牌区')
requireText(files.sidebarStorageSummary, ['XDriveSidebarStorageSummary', '存储', '无容量限制', '已使用', '磁盘可用', 'diskAvailableBytes', 'boundedDiskAvailable', '< 1 KiB', '空间紧张', '已用满', '已超额', 'LinearProgress', 'percentageLabel'], '共享侧栏存储摘要')
requireText(files.descriptionGrid, ['XDriveDescriptionGrid', 'XDriveDescriptionItem', "columns === 4", "columns === 3", "columns?: 2 | 3 | 4", "fullColumnsAt", "bgcolor: 'action.hover'", 'fullWidth', "gridColumn: fullWidth ? '1 / -1' : undefined"], '共享描述网格')
requireText(files.sectionHeader, ['XDriveSectionHeader', "level === 'h3'", 'eyebrow', 'subtitle', 'actions', 'component={level}'], '共享分区标题')
requireText(files.tableSurface, ['XDriveTableSurface', 'TableContainer', 'border: 1', "borderColor: 'divider'", 'borderRadius: 1.5', "overflowX: 'auto'"], '共享表格表面')
requireText(files.sources, ['XDriveDescriptionGrid', 'XDriveDescriptionItem'], '外部来源描述网格')
if ((files.sources.match(/<XDriveSectionHeader\b/g) || []).length !== 5) throw new Error('Web 外部来源小节标题没有完整复用共享 SectionHeader')
if (files.sources.includes('<MuiDivider') || files.sources.includes('Divider as MuiDivider')) throw new Error('Web 外部来源仍保留本地 Divider 小节标题')
requireText(files.workspaceSidebar, ['XDriveWorkspaceSidebar', 'XDriveSidebarStorageSummary'], '共享完整侧栏')
requireText(files.app, ['XDriveWorkspaceSidebar', 'usedBytes: quota.physical_used_bytes', 'totalBytes: quota.quota_bytes', 'diskAvailableBytes: quota.disk_available_bytes'], 'Web 侧栏存储摘要')
requireText(files.app, ['WebAccountMenu', 'XDriveAccountAvatarButton', 'XDriveAccountMenu', 'web-account-menu', '退出登录'], 'Web 账号菜单')
requireText(files.accountChrome, ['XDriveAccountAvatarButton', 'aria-label="账户菜单"', 'XDriveAccountSummary', 'XDriveAccountMenu', '<Avatar', '<Menu', '<Divider'], '共享账号 chrome')
if ((files.app.match(/<WebAccountMenu/g) || []).length !== 2) throw new Error('Web 两个已登录 Header 没有统一复用账号菜单')
if (files.app.includes('LogoutOutlined')) throw new Error('Web 顶栏仍保留 AntD 退出图标')
if ((files.app.match(/<XDriveBrandLockup/g) || []).length !== 3) {
  throw new Error('Web 应在登录页和两个导航品牌位统一复用共享品牌区')
}
if (files.app.includes('className="brand-lockup"') || files.app.includes('className="brand-mark"')) {
  throw new Error('Web 仍保留本地品牌区实现')
}
requireText(files.users, ['用户管理', '创建用户', '设置配额', '重置密码', 'XDriveStatusBadge', 'XDriveStatusAlert', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveWorkspaceSurface', 'XDriveConfirmDialog', 'confirmIntent={confirmAction?.danger', 'loading={confirmLoading}', 'presentation="page"', '当前用户', '需要修改', '已设置', '已超配额', 'XDriveTableSurface'], '用户管理')
if (/from ['"]antd['"]/.test(files.users) || files.users.includes('@ant-design/icons')) throw new Error('用户管理仍依赖 Ant Design')
requireText(files.workspaceSurface, ['WorkspacePresentation', "presentation === 'page'", 'workspace-page-surface', 'XDriveDialogTitle', 'XDriveDialogContent'], 'Web 工作区表面')
requireText(files.storageStats, ['WorkspaceSurface', 'presentation="page"', 'XDriveStatusBadge', 'XDriveStatusAlert', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveConfirmDialog', 'confirmIntent="danger"', 'loading={cleanupLoading}', 'XDriveMetricGrid', 'XDriveMetricCard', 'XDriveSectionHeader', "run.status === 'success' ? 'good'", "health.status === 'fail' ? 'bad'", '部分失败', 'CAS 元数据健康', 'decisionTone', 'XDriveTableSurface'], '存储状态')
requireText(files.metricCards, ['XDriveMetricGrid', 'XDriveMetricCard', 'gridTemplateColumns'], '共享统计展示')
if (files.metricCards.includes('XDriveSectionHeading')) throw new Error('共享统计组件仍内嵌旧 SectionHeading')
if (/from ['"]antd['"]/.test(files.storageStats) || files.storageStats.includes('@ant-design/icons')) throw new Error('存储统计仍依赖 Ant Design')
if (/<Alert\b/.test(files.storageStats)) throw new Error('存储统计仍在直接渲染 AntD Alert')
if ((files.storageStats.match(/<XDriveStatusAlert/g) || []).length < 10) throw new Error('存储统计状态提示没有全部复用共享 Alert')
requireText(files.audit, ['审计日志', '操作者用户名', '加载更早记录', '审计事件详情', '来源 IP', 'Request ID', 'Metadata', '登录成功', '变更用户角色', '系统更新', 'getOptionLabel={actionLabel}', 'XDriveStatusBadge', 'XDriveStatusAlert', 'XDriveWorkspaceSurface', 'XDriveDescriptionGrid', 'XDriveDescriptionItem', 'fullWidth', 'presentation="page"', 'XDriveTableSurface'], '审计日志')
if ((files.audit.match(/<XDriveDescriptionItem\b/g) || []).length !== 8) throw new Error('审计事件详情没有完整复用共享描述网格')
if (/from ['"]antd['"]/.test(files.audit) || files.audit.includes('@ant-design/icons')) throw new Error('审计日志仍依赖 Ant Design')
requireText(files.share, ['分享令牌只显示一次', '创建下载链接', '已有分享', 'XDriveSectionHeader', 'XDriveShareList', 'XDriveStatusAlert', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveActionButton'], '分享窗口')
requireText(files.shareFields, ['XDriveCreatedShareLink', 'XDriveShareCreateFields', '新创建的分享链接', '最大下载次数', '密码（可选）', '有效期', '过期时间', '0 表示不限'], '共享分享字段')
requireText(files.shareList, ['XDriveShareList', "variant === 'compact'", 'XDriveShareStatusBadge', 'XDriveTableSurface', '保护方式', '过期时间', '下载次数', '密码保护', '永不过期', '撤销'], '共享已有分享列表')
if ((files.share.match(/<XDriveShareList\b/g) || []).length !== 1) throw new Error('Web 已有分享没有复用共享列表')
if (files.share.includes('shares.map((share)') || files.share.includes('<XDriveShareStatusBadge')) throw new Error('Web 已有分享仍保留本地映射')
if ((files.share.match(/<XDriveCreatedShareLink\b/g) || []).length !== 1) throw new Error('Web 新建分享链接没有复用共享展示')
if ((files.share.match(/<XDriveShareCreateFields\b/g) || []).length !== 1) throw new Error('Web 分享创建字段没有复用共享组件')
if (files.share.includes('type="datetime-local"') || files.share.includes('label="最大下载次数"') || files.share.includes('label="密码（可选）"')) throw new Error('Web 分享窗口仍保留本地创建字段')
if (/<Alert\b/.test(files.share)) throw new Error('分享窗口仍在直接渲染 AntD Alert')
if (/from ['"]antd['"]/.test(files.share) || files.share.includes('@ant-design/icons')) throw new Error('分享窗口仍依赖 Ant Design')
requireText(files.publicShare, ['安全文件分享', '分享密码', '不限下载次数', 'XDriveStatusAlert', 'XDriveActionButton'], '公开分享')
if (/<Alert\b/.test(files.publicShare)) throw new Error('公开分享仍在直接渲染 AntD Alert')
if (/from ['"]antd['"]/.test(files.publicShare) || files.publicShare.includes('@ant-design/icons')) throw new Error('公开分享仍依赖 Ant Design')
requireText(files.sources + files.externalSourcesShared + files.sourceRunProgress + files.sourceFailureItem + files.paginationControls + files.sourceRunSummary + files.sourceScheduleFields + files.sourceCredentialFields, ['同步文件夹', '添加同步文件夹', '群晖 Photos', '一刻相册', '群晖 Photos · Push', '群晖 Photos · Pull', '保存设置', 'XDriveYikeCookieHelp', 'yikeConnectorNotice', 'yikeManagedTargetLabel', '固定逻辑目录', '立即重试', '已自动撤销', 'LinearProgress', '当前文件：', '正在取消…', '停止', '调度方式', '固定间隔', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区', '相册与集合', '该同步文件夹暂无相册/集合元数据', 'sourceCollections', 'sourceCollectionItems', 'XDriveSourceTargetField', 'XDriveStoredCredentialField', '已保存 Cookie', '已保存 DSM 密码', '替换 Cookie', 'revealSourceCredential', 'XDriveStatusBadge', 'runDetail.statusTone', 'XDriveSourceRunProgress', 'XDriveSourceFailureItem', 'XDrivePaginationControls', 'XDriveDialogTitle', 'xDriveDialogPaperProps', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert', 'WorkspaceSurface', 'presentation="page"', 'pageActions={', 'XDriveSectionHeader'], '同步文件夹')
if (files.sources.includes('<DialogTitle')) throw new Error('Web 外部来源仍在直接渲染原生 DialogTitle')
if (files.sources.includes('<MuiAlert')) throw new Error('Web 外部来源仍在直接渲染原生 MUI Alert')
if (((files.sources + files.workspaceSurface).match(/<XDriveDialogTitle/g) || []).length < 8) throw new Error('Web 外部来源弹窗没有全部复用共享 Dialog chrome')
if (files.sources.includes('<DialogActions')) throw new Error('Web 外部来源仍在直接渲染原生 MUI DialogActions')
if (((files.sources + files.workspaceSurface).match(/<XDriveDialogActions/g) || []).length !== 8) throw new Error('Web 外部来源弹窗没有全部复用共享 DialogActions')
if (/<DialogContent(?:\s|>)/.test(files.sources)) throw new Error('Web 外部来源仍在直接渲染原生 MUI DialogContent')
if (((files.sources + files.workspaceSurface).match(/<XDriveDialogContent/g) || []).length !== 8) throw new Error('Web 外部来源弹窗没有全部复用共享 DialogContent')
if ((files.sources.match(/<XDriveStatusAlert/g) || []).length < 16) throw new Error('Web 外部来源状态提示没有全部复用共享 Alert')
if (!files.sources.includes('XDriveActionButton')) throw new Error('Web 外部来源没有复用共享操作按钮')
requireText(files.sources, ['XDriveDialogActionSpacer', 'id="external-source-create-form"', 'form="external-source-create-form"', 'id="external-source-settings-form"', 'form="external-source-settings-form"'], '外部来源共享弹窗操作区')
if ((files.sources.match(/<XDriveDialogActionSpacer\b/g) || []).length !== 1) throw new Error('外部来源设置弹窗没有使用共享操作区分隔符')
if (files.sources.includes("display: 'flex', justifyContent: 'flex-end', gap: 1")) throw new Error('添加来源仍保留本地弹窗操作区')
if (files.sources.includes("display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap'")) throw new Error('来源设置仍保留本地弹窗操作区')
if ((files.sources.match(/<MuiButton/g) || []).length !== 5) throw new Error('共享同步文件夹功能的特殊 MUI 按钮数量发生漂移')
if ((files.sources.match(/<XDriveActionButton/g) || []).length < 20) throw new Error('Web 外部来源常规操作按钮没有全部共享化')
if (files.sources.includes('@ant-design/icons')) throw new Error('Web 外部来源仍依赖 Ant Design icons')
if (files.sources.includes('message.success') || /<Button\b/.test(files.sources) || /<Space\b/.test(files.sources) || /<Divider\b/.test(files.sources)) throw new Error('Web 外部来源外壳仍使用已迁移的 AntD 组件')
if (/from ['"]antd['"]/.test(files.sources) || files.sources.includes('@ant-design/icons')) throw new Error('Web 外部来源仍依赖 Ant Design')
if (/<Descriptions\b/.test(files.sources) || /<Spin\b/.test(files.sources) || /<Form\b/.test(files.sources) || /<Input\b/.test(files.sources) || /<Select\b/.test(files.sources) || files.sources.includes('Typography.')) throw new Error('Web 外部来源仍渲染 AntD 组件')
requireText(files.sources, ['XDriveDescriptionGrid', 'XDriveDescriptionItem', '复制运行 ID', 'CircularProgress', 'initialCreateSourceValues', 'settingsValues', 'XDriveSynologyPhotoSpacesField', 'XDriveSynologyFileRootsField'], '外部来源 MUI 表单与详情展示')
if (files.sources.includes('<LinearProgress')) throw new Error('Web 外部来源仍在直接渲染运行进度条')
if ((files.sources.match(/<XDriveSourceRunProgress/g) || []).length !== 1) throw new Error('Web 外部来源运行进度没有复用共享组件')
requireText(files.sourceRunProgress, ['ExternalSourceRunProgressView', 'LinearProgress', '当前文件：', '正在取消…', 'XDriveActionButton'], '外部来源运行进度')
if ((files.sources.match(/<XDriveSourceFailureItem/g) || []).length !== 2) throw new Error('Web 外部来源失败文件没有全部复用共享 item')
if (files.sources.includes('<MuiBox key={failure.id}') || files.sources.includes('<MuiBox key={item.source_item_id}')) throw new Error('Web 外部来源仍保留本地失败文件卡片')
requireText(files.sourceFailureItem, ['formatExternalSourceTime(failedAt)', '外部 ID：', '未提供具体错误原因', 'XDriveStatusAlert'], '外部来源失败文件 item')
if ((files.sources.match(/<XDrivePaginationControls/g) || []).length !== 3) throw new Error('Web 外部来源历史、失败与集合分页没有全部复用共享控件')
if (files.sources.includes('失败项第 {failurePage.page}') || files.sources.includes('第 {historyPage} 页 · 每页')) throw new Error('Web 外部来源仍保留本地分页文案')
requireText(files.paginationControls, ['XDriveActionButton', 'page <= 1', 'loading || !hasNext', '上一页', '下一页'], '共享分页控件')
if ((files.sources.match(/<XDriveSourceRunSummary/g) || []).length !== 1) throw new Error('Web 外部来源运行摘要没有复用共享组件')
requireText(files.sourceRunSummary, ['ExternalSourceRunDetailView', 'XDriveStatusBadge', 'detail.modeLabel', 'detail.triggerLabel', 'formatExternalSourceTime(detail.startedAt)', '成功', '失败'], '外部来源运行摘要')
requireText(files.sourceCollection, ['XDriveSourceCollectionSummary', 'XDriveSourceCollectionItem', 'externalSourceCollectionKindLabel', 'externalSourceCollectionStateTone', 'formatExternalSourceTime', '远端缺失', '原始路径'], '共享来源集合展示')
requireText(files.sourceScheduleFields, ['XDriveSourceScheduleFields', '调度方式', '固定间隔', 'Cron', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区', 'onScheduleTypeChange', 'onExpressionChange', 'onTimezoneChange'], '共享来源调度字段')
requireText(files.sourceBasicFields, ['XDriveSourcePresetField', 'XDriveSourceNameField', 'XDriveSourceRunModeField', 'XDriveSourceStatusField', '同步文件夹类型', '同步文件夹名称', '运行模式', '启用', '暂停'], '共享同步文件夹基础字段')
requireText(files.sourceCredentialFields, ['XDriveSourceCookieField', 'XDriveSourceTargetField', 'XDriveStoredCredentialField', 'XDriveSynologyDsmCredentialFields', '一刻相册 Cookie', 'DSM 地址', 'DSM 用户名', 'DSM 密码', '更新 DSM 地址', '留空则保持当前配置不变', '目标目录', 'expiresInSeconds = 30', 'synologyDsmAddressHelp'], '共享同步文件夹凭据字段')
requireText(files.sourceConnectorConfigFields, ['XDriveSynologyPhotoSpacesField', 'XDriveSynologyFileRootsField', '同步空间', 'File Station 根目录', 'synologyPhotoSpaceOptions', 'normalizeSynologyPhotoSpaces', '每行一个 DSM 绝对目录'], '共享来源连接配置字段')
if ((files.sources.match(/<XDriveSynologyPhotoSpacesField\b/g) || []).length !== 2) throw new Error('Web Photos 创建/设置没有完整复用共享空间字段')
if ((files.sources.match(/<XDriveSynologyFileRootsField\b/g) || []).length !== 2) throw new Error('Web File Station 创建/设置没有完整复用共享根目录字段')
if (files.sources.includes('create-source-spaces-label') || files.sources.includes('settings-source-spaces-label')) throw new Error('Web 仍保留本地 Synology Photos 空间选择器')
if (files.sources.includes('label="File Station 根目录"')) throw new Error('Web 仍保留本地 File Station 根目录字段')
if ((files.sources.match(/<XDriveSourceCookieField\b/g) || []).length !== 2) throw new Error('Web Cookie 创建/设置没有完整复用共享字段')
if ((files.sources.match(/<XDriveSynologyDsmCredentialFields\b/g) || []).length !== 2) throw new Error('Web DSM 创建/设置没有完整复用共享字段组')
for (const legacy of ['一刻相册 Cookie', 'DSM 地址', 'DSM 用户名', 'DSM 密码', '更新 DSM 地址', '更新 DSM 用户名', '更新 DSM 密码']) {
  const localFieldPattern = new RegExp('<TextField[\\s\\S]{0,220}label="' + legacy + '"')
  if (localFieldPattern.test(files.sources)) throw new Error(`Web 来源仍保留本地凭据字段：${legacy}`)
}
if (files.sources.includes('synologyDsmAddressHelp')) throw new Error('Web 来源仍直接维护 DSM 地址帮助文案')
if ((files.sources.match(/<XDriveSourcePresetField\b/g) || []).length !== 1) throw new Error('Web 来源创建没有复用共享来源类型字段')
if ((files.sources.match(/<XDriveSourceNameField\b/g) || []).length !== 2) throw new Error('Web 来源创建/设置没有完整复用共享名称字段')
if ((files.sources.match(/<XDriveSourceRunModeField\b/g) || []).length !== 2) throw new Error('Web 来源创建/设置没有完整复用共享运行模式字段')
if ((files.sources.match(/<XDriveSourceStatusField\b/g) || []).length !== 1) throw new Error('Web 来源设置没有复用共享状态字段')
for (const legacy of ['同步文件夹名称', '初始运行模式', '运行模式']) {
  const localFieldPattern = new RegExp('<TextField[\\s\\S]{0,220}label="' + legacy + '"')
  if (localFieldPattern.test(files.sources)) throw new Error(`Web 来源仍保留本地基础字段：${legacy}`)
}
requireText(files.sourceIgnoreRulesField, ['XDriveSourceIgnoreRulesField', '忽略规则', 'gitignore 风格规则', 'spellCheck: false', 'monospace'], '共享来源忽略规则字段')
if ((files.sources.match(/<XDriveSourceIgnoreRulesField\b/g) || []).length !== 2) throw new Error('Web 来源创建/设置没有完整复用共享忽略规则字段')
if (files.sources.includes('label="忽略规则"')) throw new Error('Web 来源仍保留本地忽略规则字段')
if ((files.sources.match(/<XDriveSourceScheduleFields\b/g) || []).length !== 2) throw new Error('Web 来源创建/设置没有完整复用共享调度字段')
if (files.sources.includes("label=\"调度方式\"") || files.sources.includes("gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }")) throw new Error('Web 来源仍保留本地调度字段组')
if ((files.sources.match(/<XDriveSourceCollectionSummary\b/g) || []).length !== 1) throw new Error('Web 来源集合摘要没有复用共享组件')
if ((files.sources.match(/<XDriveSourceCollectionItem\b/g) || []).length !== 1) throw new Error('Web 来源集合成员没有复用共享组件')
if (files.sources.includes('externalSourceCollectionKindLabel(collection.kind)') || files.sources.includes("item.state === 'synced' ? 'good'")) throw new Error('Web 来源集合仍保留本地展示逻辑')
requireText(files.yikeCookieHelp, ['如何获取 Cookie？', '点击展开', '关闭', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert'], '一刻相册 Cookie 帮助')
if (/<Alert\b/.test(files.yikeCookieHelp)) throw new Error('一刻相册 Cookie 帮助仍在直接渲染原生 MUI Alert')
if (/<DialogContent(?:\s|>)/.test(files.yikeCookieHelp)) throw new Error('一刻相册 Cookie 帮助仍在直接渲染原生 MUI DialogContent')
requireText(files.synologyGuide, ['群晖 DSM 配置', 'DSM 操作示意图', '上一步', '下一步', '完成', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert'], '群晖 DSM 向导')
if (/<Alert\b/.test(files.synologyGuide)) throw new Error('群晖 DSM 向导仍在直接渲染原生 MUI Alert')
if (/<DialogContent(?:\s|>)/.test(files.synologyGuide)) throw new Error('群晖 DSM 向导仍在直接渲染原生 MUI DialogContent')
requireText(files.main, ['XDriveAppearanceThemeProvider', 'normalizeXDriveAppearance', "xdrive.appearance", '<App appearance={appearance} onAppearanceChange={changeAppearance} />'], 'MUI Web 入口')
requireText(files.app + files.settingsDialog, ['<ListItemText>设置</ListItemText>', 'subtitle="外观与服务端信息"', 'XDriveAppearanceField', 'XDriveBuildInfoCard', 'Server 构建信息'], 'Web 设置弹窗')
if (/antd|ConfigProvider|AntApp|zhCN/.test(files.main)) throw new Error('Web 入口仍保留 Ant Design provider')
if (/\.ant-[a-zA-Z0-9_-]+/.test(files.styles)) throw new Error('Web CSS 仍保留 Ant Design 选择器')

const webPackage = JSON.parse(files.packageJson)
if (webPackage.dependencies?.antd || webPackage.dependencies?.['@ant-design/icons']) {
  throw new Error('Web package.json 仍依赖 Ant Design')
}
const webLock = JSON.parse(files.packageLock)
const webLockKeys = Object.keys(webLock.packages ?? {})
if (webLockKeys.some((key) => key === 'node_modules/antd' || key.startsWith('node_modules/@ant-design/'))) {
  throw new Error('Web package-lock.json 仍包含 Ant Design 包')
}

const sourceFiles = []
const collectSourceFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectSourceFiles(fullPath)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) sourceFiles.push(fullPath)
  }
}
collectSourceFiles(path.join(root, 'src'))
for (const sourcePath of sourceFiles) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  if (/from\s+['"]antd(?:\/[^'"]*)?['"]/.test(source) || /import\s+['"]antd(?:\/[^'"]*)?['"]/.test(source) || source.includes('@ant-design/icons')) {
    throw new Error(`Web 源码仍依赖 Ant Design：${path.relative(root, sourcePath)}`)
  }
}
requireText(files.html, ['<html lang="zh-CN">', 'xDrive 网页文件管理器'], '网页入口')

forbidText(files.app, [
  '>Sign in</Button>',
  '>Sign out</Button>',
  '>Users',
  '>Audit',
  '>Refresh</Button>',
  '>Recycle bin</Button>',
  '>New folder</Button>',
  'title="Recycle bin"',
  'title="New folder"',
  'title="Rename"',
  'Version history —',
], '文件管理器')
forbidText(files.users, ['title="User management"', '>Set quota', '>Reset password', '>Create user'], '用户管理')
forbidText(files.audit, ['title="Audit log"', 'placeholder="Actor username"', '>Apply</Button>', '>Clear'], '审计日志')
forbidText(files.share, ['Share tokens are shown only once', 'Create a download link', '>Revoke'], '分享窗口')
forbidText(files.publicShare, ['Secure file share', 'placeholder="Share password"', '>Download'], '公开分享')

console.log('Web Chinese GUI checks passed')

if ((files.users.match(/<XDriveConfirmDialog/g) || []).length !== 1) throw new Error('用户管理危险操作没有统一复用共享确认框')
if ((files.storageStats.match(/<XDriveConfirmDialog/g) || []).length !== 1) throw new Error('存储清理确认没有统一复用共享确认框')


const sharedTableSurfaceExpectations = [
  [files.audit, 1, '审计日志'],
  [files.users, 1, '用户管理'],
  [files.storageStats, 3, '存储统计'],
]
if ((files.shareList.match(/<XDriveTableSurface\b/g) || []).length !== 1) throw new Error('共享分享列表的表格模式没有复用 TableSurface')
for (const [source, expected, label] of sharedTableSurfaceExpectations) {
  if ((source.match(/<XDriveTableSurface\b/g) || []).length !== expected) {
    throw new Error(`${label} 没有完整复用共享表格表面`)
  }
  if (source.includes('<TableContainer')) throw new Error(`${label} 仍保留本地带边框 TableContainer`)
}
