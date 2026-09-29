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
  synologyGuide: readRepo('ui/shared/src/mui/SynologyDsmGuideDialog.tsx'),
  yikeCookieHelp: readRepo('ui/shared/src/mui/YikeCookieHelp.tsx'),
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

requireText(files.app, ['登录', '我的文件', '回收站', '新建文件夹', '版本历史'], '文件管理器')
requireText(files.app, ['src={xDriveBrandIcon}'], 'xDrive 品牌图标')
if ((files.app.match(/src=\{xDriveBrandIcon\}/g) || []).length !== 3) {
  throw new Error('Web 应在登录页和两个导航品牌位统一使用主应用图标')
}
if (files.app.includes('<div className="brand-mark">x</div>') || files.app.includes('<div className="brand-mark small">x</div>')) {
  throw new Error('Web 仍存在旧的文字 x 品牌标识')
}
requireText(files.users, ['用户管理', '创建用户', '设置配额', '重置密码', 'XDriveStatusBadge', '当前用户', '需要修改', '已设置', '已超配额'], '用户管理')
requireText(files.storageStats, ['XDriveStatusBadge', 'XDriveStatusAlert', "run.status === 'success' ? 'good'", "health.status === 'fail' ? 'bad'", '部分失败', 'CAS 元数据健康'], '存储状态')
requireText(files.audit, ['审计日志', '操作者用户名', '加载更早记录'], '审计日志')
requireText(files.share, ['分享令牌只显示一次', '创建下载链接', '已有分享', 'XDriveShareStatusBadge'], '分享窗口')
requireText(files.publicShare, ['安全文件分享', '分享密码', '不限下载次数'], '公开分享')
requireText(files.sources, ['外部来源', '添加来源', '群晖 Photos', '一刻相册', '保存设置', 'XDriveYikeCookieHelp', 'yikeConnectorNotice', 'yikeManagedTargetLabel', '固定逻辑目录', '立即重试', '已自动撤销', 'LinearProgress', '当前文件：', '正在取消…', '停止', '调度方式', '固定间隔', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区', 'XDriveStatusBadge', 'runDetail.statusTone'], '外部来源')
requireText(files.yikeCookieHelp, ['如何获取 Cookie？', '点击展开', '关闭'], '一刻相册 Cookie 帮助')
requireText(files.synologyGuide, ['群晖 DSM 配置', 'DSM 操作示意图', '上一步', '下一步', '完成'], '群晖 DSM 向导')
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
