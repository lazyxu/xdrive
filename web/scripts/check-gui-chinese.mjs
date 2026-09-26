import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

const files = {
  app: read('src/App.tsx'),
  users: read('src/AdminUsers.tsx'),
  audit: read('src/AdminAudit.tsx'),
  share: read('src/ShareDialog.tsx'),
  publicShare: read('src/PublicShare.tsx'),
  sources: read('src/ExternalSources.tsx'),
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
requireText(files.users, ['用户管理', '创建用户', '设置配额', '重置密码'], '用户管理')
requireText(files.audit, ['审计日志', '操作者用户名', '加载更早记录'], '审计日志')
requireText(files.share, ['分享令牌只显示一次', '创建下载链接', '已有分享'], '分享窗口')
requireText(files.publicShare, ['安全文件分享', '分享密码', '不限下载次数'], '公开分享')
requireText(files.sources, ['外部来源', '添加来源', '群晖 Photos', '一刻相册', '保存设置'], '外部来源')
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
