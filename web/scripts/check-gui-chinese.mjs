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
  storageStats: read('src/StorageStatsModal.tsx'),
  share: read('src/ShareDialog.tsx'),
  publicShare: read('src/PublicShare.tsx'),
  sources: read('src/ExternalSources.tsx'),
  externalSourcesShared: readRepo('ui/shared/src/external-sources.ts'),
  synologyGuide: readRepo('ui/shared/src/mui/SynologyDsmGuideDialog.tsx'),
  yikeCookieHelp: readRepo('ui/shared/src/mui/YikeCookieHelp.tsx'),
  sourceRunProgress: readRepo('ui/shared/src/mui/SourceRunProgress.tsx'),
  sourceFailureItem: readRepo('ui/shared/src/mui/SourceFailureItem.tsx'),
  paginationControls: readRepo('ui/shared/src/mui/PaginationControls.tsx'),
  sourceRunSummary: readRepo('ui/shared/src/mui/SourceRunSummary.tsx'),
  main: read('src/main.tsx'),
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
if (/<Alert\b/.test(files.app)) throw new Error('Web 主界面仍在直接渲染 AntD Alert')
requireText(files.app, ['src={xDriveBrandIcon}'], 'xDrive 品牌图标')
if ((files.app.match(/src=\{xDriveBrandIcon\}/g) || []).length !== 3) {
  throw new Error('Web 应在登录页和两个导航品牌位统一使用主应用图标')
}
if (files.app.includes('<div className="brand-mark">x</div>') || files.app.includes('<div className="brand-mark small">x</div>')) {
  throw new Error('Web 仍存在旧的文字 x 品牌标识')
}
requireText(files.users, ['用户管理', '创建用户', '设置配额', '重置密码', 'XDriveStatusBadge', '当前用户', '需要修改', '已设置', '已超配额'], '用户管理')
requireText(files.storageStats, ['XDriveStatusBadge', 'XDriveStatusAlert', "run.status === 'success' ? 'good'", "health.status === 'fail' ? 'bad'", '部分失败', 'CAS 元数据健康', 'decisionTone'], '存储状态')
if (/<Alert\b/.test(files.storageStats)) throw new Error('存储统计仍在直接渲染 AntD Alert')
if ((files.storageStats.match(/<XDriveStatusAlert/g) || []).length < 10) throw new Error('存储统计状态提示没有全部复用共享 Alert')
requireText(files.audit, ['审计日志', '操作者用户名', '加载更早记录'], '审计日志')
requireText(files.share, ['分享令牌只显示一次', '创建下载链接', '已有分享', 'XDriveShareStatusBadge', 'XDriveStatusAlert'], '分享窗口')
if (/<Alert\b/.test(files.share)) throw new Error('分享窗口仍在直接渲染 AntD Alert')
requireText(files.publicShare, ['安全文件分享', '分享密码', '不限下载次数', 'XDriveStatusAlert'], '公开分享')
if (/<Alert\b/.test(files.publicShare)) throw new Error('公开分享仍在直接渲染 AntD Alert')
requireText(files.sources + files.externalSourcesShared + files.sourceRunProgress + files.sourceFailureItem + files.paginationControls + files.sourceRunSummary, ['外部来源', '添加来源', '群晖 Photos', '一刻相册', '群晖 Photos · Push', '群晖 Photos · Pull', '保存设置', 'XDriveYikeCookieHelp', 'yikeConnectorNotice', 'yikeManagedTargetLabel', '固定逻辑目录', '立即重试', '已自动撤销', 'LinearProgress', '当前文件：', '正在取消…', '停止', '调度方式', '固定间隔', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区', 'XDriveStatusBadge', 'runDetail.statusTone', 'XDriveSourceRunProgress', 'XDriveSourceFailureItem', 'XDrivePaginationControls', 'XDriveSourceRunSummary', 'XDriveDialogTitle', 'xDriveDialogPaperProps', 'XDriveDialogActions', 'XDriveDialogContent', 'XDriveStatusAlert'], '外部来源')
if (files.sources.includes('<DialogTitle')) throw new Error('Web 外部来源仍在直接渲染原生 DialogTitle')
if (files.sources.includes('<MuiAlert')) throw new Error('Web 外部来源仍在直接渲染原生 MUI Alert')
if ((files.sources.match(/<XDriveDialogTitle/g) || []).length < 8) throw new Error('Web 外部来源弹窗没有全部复用共享 Dialog chrome')
if (files.sources.includes('<DialogActions')) throw new Error('Web 外部来源仍在直接渲染原生 MUI DialogActions')
if ((files.sources.match(/<XDriveDialogActions>/g) || []).length !== 6) throw new Error('Web 外部来源弹窗没有全部复用共享 DialogActions')
if (/<DialogContent(?:\s|>)/.test(files.sources)) throw new Error('Web 外部来源仍在直接渲染原生 MUI DialogContent')
if ((files.sources.match(/<XDriveDialogContent/g) || []).length !== 8) throw new Error('Web 外部来源弹窗没有全部复用共享 DialogContent')
if ((files.sources.match(/<XDriveStatusAlert/g) || []).length < 16) throw new Error('Web 外部来源状态提示没有全部复用共享 Alert')
if (!files.sources.includes('XDriveActionButton')) throw new Error('Web 外部来源没有复用共享操作按钮')
if ((files.sources.match(/<MuiButton/g) || []).length !== 3) throw new Error('Web 外部来源仅允许保留 3 个 text/inherit 特殊 MUI 按钮')
if ((files.sources.match(/<XDriveActionButton/g) || []).length < 14) throw new Error('Web 外部来源常规 MUI 操作按钮没有全部共享化')
if (files.sources.includes('<LinearProgress')) throw new Error('Web 外部来源仍在直接渲染运行进度条')
if ((files.sources.match(/<XDriveSourceRunProgress/g) || []).length !== 1) throw new Error('Web 外部来源运行进度没有复用共享组件')
requireText(files.sourceRunProgress, ['ExternalSourceRunProgressView', 'LinearProgress', '当前文件：', '正在取消…', 'XDriveActionButton'], '外部来源运行进度')
if ((files.sources.match(/<XDriveSourceFailureItem/g) || []).length !== 2) throw new Error('Web 外部来源失败文件没有全部复用共享 item')
if (files.sources.includes('<MuiBox key={failure.id}') || files.sources.includes('<MuiBox key={item.source_item_id}')) throw new Error('Web 外部来源仍保留本地失败文件卡片')
requireText(files.sourceFailureItem, ['formatExternalSourceTime(failedAt)', '外部 ID：', '未提供具体错误原因', 'XDriveStatusAlert'], '外部来源失败文件 item')
if ((files.sources.match(/<XDrivePaginationControls/g) || []).length !== 2) throw new Error('Web 外部来源历史与失败分页没有全部复用共享控件')
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
requireText(files.main, ["import zhCN from 'antd/locale/zh_CN'", 'locale={zhCN}'], 'Ant Design')
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
