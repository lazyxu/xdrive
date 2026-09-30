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
  share: read('src/ShareDialog.tsx'),
  publicShare: read('src/PublicShare.tsx'),
  sources: read('src/ExternalSources.tsx'),
  workspaceSurface: readRepo('ui/shared/src/mui/WorkspaceSurface.tsx'),
  accountChrome: readRepo('ui/shared/src/mui/AccountChrome.tsx'),
  brandLockup: readRepo('ui/shared/src/mui/BrandLockup.tsx'),
  confirmDialog: readRepo('ui/shared/src/mui/ConfirmDialog.tsx'),
  sidebarStorageSummary: readRepo('ui/shared/src/mui/SidebarStorageSummary.tsx'),
  externalSourcesShared: readRepo('ui/shared/src/external-sources.ts'),
  synologyGuide: readRepo('ui/shared/src/mui/SynologyDsmGuideDialog.tsx'),
  yikeCookieHelp: readRepo('ui/shared/src/mui/YikeCookieHelp.tsx'),
  sourceRunProgress: readRepo('ui/shared/src/mui/SourceRunProgress.tsx'),
  sourceFailureItem: readRepo('ui/shared/src/mui/SourceFailureItem.tsx'),
  paginationControls: readRepo('ui/shared/src/mui/PaginationControls.tsx'),
  sourceRunSummary: readRepo('ui/shared/src/mui/SourceRunSummary.tsx'),
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

requireText(files.app, ['登录', '我的文件', '回收站', '新建文件夹', '版本历史', 'XDriveStatusAlert'], '文件管理器')
if (/from ['"]antd['"]/.test(files.app) || files.app.includes('@ant-design/icons')) throw new Error('Web 主文件管理器仍依赖 Ant Design')
requireText(files.app, ['XDriveActionButton', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveDialogActions', 'XDriveConfirmDialog', 'XDriveStatePanel', 'XDriveMediaGalleryPage'], 'Web MUI 文件管理器')
requireText(files.confirmDialog, ['XDriveConfirmDialog', 'aria-label="确认操作"', 'closeDisabled={loading}', 'XDriveActionButton'], '共享确认框')
requireText(files.app, ['XDriveConfirmDialog', 'confirmIntent={confirmAction?.intent', 'loading={confirmBusy}'], 'Web 确认框')
if (/<Alert\b/.test(files.app)) throw new Error('Web 主界面仍在直接渲染 AntD Alert')
requireText(files.app, ['XDriveBrandLockup', 'iconSrc={xDriveBrandIcon}'], 'xDrive 品牌图标')
requireText(files.brandLockup, ['XDriveBrandLockup', "variant === 'titlebar'", "variant === 'large'", 'component="img"', 'xDrive'], '共享品牌区')
requireText(files.sidebarStorageSummary, ['XDriveSidebarStorageSummary', '存储空间', '不限配额', '空间紧张', '已用满', '已超额', 'LinearProgress', 'percentageLabel'], '共享侧栏存储摘要')
requireText(files.app, ['XDriveSidebarStorageSummary', 'usedBytes={quota.physical_used_bytes}', 'totalBytes={quota.quota_bytes}'], 'Web 侧栏存储摘要')
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
requireText(files.users, ['用户管理', '创建用户', '设置配额', '重置密码', 'XDriveStatusBadge', 'XDriveStatusAlert', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveWorkspaceSurface', 'XDriveConfirmDialog', 'confirmIntent={confirmAction?.danger', 'loading={confirmLoading}', 'presentation="page"', '当前用户', '需要修改', '已设置', '已超配额'], '用户管理')
if (/from ['"]antd['"]/.test(files.users) || files.users.includes('@ant-design/icons')) throw new Error('用户管理仍依赖 Ant Design')
requireText(files.workspaceSurface, ['WorkspacePresentation', "presentation === 'page'", 'workspace-page-surface', 'XDriveDialogTitle', 'XDriveDialogContent'], 'Web 工作区表面')
requireText(files.storageStats, ['WorkspaceSurface', 'presentation="page"', 'XDriveStatusBadge', 'XDriveStatusAlert', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveConfirmDialog', 'confirmIntent="danger"', 'loading={cleanupLoading}', 'StorageStatGrid', 'StorageStat', "run.status === 'success' ? 'good'", "health.status === 'fail' ? 'bad'", '部分失败', 'CAS 元数据健康', 'decisionTone'], '存储状态')
if (/from ['"]antd['"]/.test(files.storageStats) || files.storageStats.includes('@ant-design/icons')) throw new Error('存储统计仍依赖 Ant Design')
if (/<Alert\b/.test(files.storageStats)) throw new Error('存储统计仍在直接渲染 AntD Alert')
if ((files.storageStats.match(/<XDriveStatusAlert/g) || []).length < 10) throw new Error('存储统计状态提示没有全部复用共享 Alert')
requireText(files.audit, ['审计日志', '操作者用户名', '加载更早记录', '审计事件详情', '来源 IP', 'Request ID', 'Metadata', '登录成功', '变更用户角色', '系统更新', 'getOptionLabel={actionLabel}', 'XDriveStatusBadge', 'XDriveStatusAlert', 'XDriveWorkspaceSurface', 'presentation="page"'], '审计日志')
if (/from ['"]antd['"]/.test(files.audit) || files.audit.includes('@ant-design/icons')) throw new Error('审计日志仍依赖 Ant Design')
requireText(files.share, ['分享令牌只显示一次', '创建下载链接', '已有分享', 'XDriveShareStatusBadge', 'XDriveStatusAlert', 'XDriveDialogTitle', 'XDriveDialogContent', 'XDriveActionButton'], '分享窗口')
if (/<Alert\b/.test(files.share)) throw new Error('分享窗口仍在直接渲染 AntD Alert')
if (/from ['"]antd['"]/.test(files.share) || files.share.includes('@ant-design/icons')) throw new Error('分享窗口仍依赖 Ant Design')
requireText(files.publicShare, ['安全文件分享', '分享密码', '不限下载次数', 'XDriveStatusAlert', 'XDriveActionButton'], '公开分享')
if (/<Alert\b/.test(files.publicShare)) throw new Error('公开分享仍在直接渲染 AntD Alert')
if (/from ['"]antd['"]/.test(files.publicShare) || files.publicShare.includes('@ant-design/icons')) throw new Error('公开分享仍依赖 Ant Design')
requireText(files.sources + files.externalSourcesShared + files.sourceRunProgress + files.sourceFailureItem + files.paginationControls + files.sourceRunSummary, ['外部来源', '添加来源', '群晖 Photos', '一刻相册', '群晖 Photos · Push', '群晖 Photos · Pull', '保存设置', 'XDriveYikeCookieHelp', 'yikeConnectorNotice', 'yikeManagedTargetLabel', '固定逻辑目录', '立即重试', '已自动撤销', 'LinearProgress', '当前文件：', '正在取消…', '停止', '调度方式', '固定间隔', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区', '相册与集合', '该来源暂无相册/集合元数据', 'sourceCollections', 'sourceCollectionItems', 'externalSourceSavedCredentialMask', 'isExternalSourceSavedCredentialMask', '当前已保存的 Cookie 以遮罩显示', 'XDriveStatusBadge', 'runDetail.statusTone', 'XDriveSourceRunProgress', 'XDriveSourceFailureItem', 'XDrivePaginationControls', 'XDriveDialogTitle', 'xDriveDialogPaperProps', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert', 'WorkspaceSurface', 'presentation="page"', 'pageActions={'], '外部来源')
if (files.sources.includes('<DialogTitle')) throw new Error('Web 外部来源仍在直接渲染原生 DialogTitle')
if (files.sources.includes('<MuiAlert')) throw new Error('Web 外部来源仍在直接渲染原生 MUI Alert')
if (((files.sources + files.workspaceSurface).match(/<XDriveDialogTitle/g) || []).length < 8) throw new Error('Web 外部来源弹窗没有全部复用共享 Dialog chrome')
if (files.sources.includes('<DialogActions')) throw new Error('Web 外部来源仍在直接渲染原生 MUI DialogActions')
if (((files.sources + files.workspaceSurface).match(/<XDriveDialogActions/g) || []).length !== 6) throw new Error('Web 外部来源弹窗没有全部复用共享 DialogActions')
if (/<DialogContent(?:\s|>)/.test(files.sources)) throw new Error('Web 外部来源仍在直接渲染原生 MUI DialogContent')
if (((files.sources + files.workspaceSurface).match(/<XDriveDialogContent/g) || []).length !== 8) throw new Error('Web 外部来源弹窗没有全部复用共享 DialogContent')
if ((files.sources.match(/<XDriveStatusAlert/g) || []).length < 16) throw new Error('Web 外部来源状态提示没有全部复用共享 Alert')
if (!files.sources.includes('XDriveActionButton')) throw new Error('Web 外部来源没有复用共享操作按钮')
if ((files.sources.match(/<MuiButton/g) || []).length !== 3) throw new Error('Web 外部来源仅允许保留 3 个 text/inherit 特殊 MUI 按钮')
if ((files.sources.match(/<XDriveActionButton/g) || []).length < 20) throw new Error('Web 外部来源常规操作按钮没有全部共享化')
if (files.sources.includes('@ant-design/icons')) throw new Error('Web 外部来源仍依赖 Ant Design icons')
if (files.sources.includes('message.success') || /<Button\b/.test(files.sources) || /<Space\b/.test(files.sources) || /<Divider\b/.test(files.sources)) throw new Error('Web 外部来源外壳仍使用已迁移的 AntD 组件')
if (/from ['"]antd['"]/.test(files.sources) || files.sources.includes('@ant-design/icons')) throw new Error('Web 外部来源仍依赖 Ant Design')
if (/<Descriptions\b/.test(files.sources) || /<Spin\b/.test(files.sources) || /<Form\b/.test(files.sources) || /<Input\b/.test(files.sources) || /<Select\b/.test(files.sources) || files.sources.includes('Typography.')) throw new Error('Web 外部来源仍渲染 AntD 组件')
requireText(files.sources, ['SourceDescriptionGrid', 'SourceDescriptionItem', '复制运行 ID', 'CircularProgress', 'initialCreateSourceValues', 'settingsValues', 'MuiSelect', 'FormControl'], '外部来源 MUI 表单与详情展示')
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
requireText(files.yikeCookieHelp, ['如何获取 Cookie？', '点击展开', '关闭', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert'], '一刻相册 Cookie 帮助')
if (/<Alert\b/.test(files.yikeCookieHelp)) throw new Error('一刻相册 Cookie 帮助仍在直接渲染原生 MUI Alert')
if (/<DialogContent(?:\s|>)/.test(files.yikeCookieHelp)) throw new Error('一刻相册 Cookie 帮助仍在直接渲染原生 MUI DialogContent')
requireText(files.synologyGuide, ['群晖 DSM 配置', 'DSM 操作示意图', '上一步', '下一步', '完成', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert'], '群晖 DSM 向导')
if (/<Alert\b/.test(files.synologyGuide)) throw new Error('群晖 DSM 向导仍在直接渲染原生 MUI Alert')
if (/<DialogContent(?:\s|>)/.test(files.synologyGuide)) throw new Error('群晖 DSM 向导仍在直接渲染原生 MUI DialogContent')
requireText(files.main, ['MuiThemeProvider', 'createXDriveMuiTheme', '<App />'], 'MUI Web 入口')
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
