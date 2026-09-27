const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')
const synologyGuide = fs.readFileSync(path.join(root, 'src', 'renderer', 'SynologyDsmGuideDialog.tsx'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')

test('desktop GUI defaults to Chinese', () => {
  for (const text of [
    '概览',
    '云端文件',
    '外部来源',
    '立即扫描',
    '来源设置',
    '保存设置',
    '添加外部来源',
    '目标文件夹',
    '添加来源',
    '传输中心',
    '存储策略',
    '冲突副本',
    '客户端诊断',
    '客户端设置',
    '客户端更新',
    '关闭窗口时最小化到系统托盘',
    '手动检查',
    '自动检查',
    '有更新自动下载',
    '自动更新',
    '检查更新',
    '下载更新',
    '创建分享链接',
  ]) {
    assert.ok(renderer.includes(text), `missing Chinese desktop label: ${text}`)
  }

  for (const text of [
    '打开 xDrive 桌面版',
    '打开 xDrive 文件夹',
    '立即同步',
    '暂停同步',
    '退出 xDrive 桌面版',
    '客户端更新',
    '检查更新',
    '关闭 xDrive 桌面版',
    '最小化到托盘',
    '选择 xDrive 同步文件夹',
  ]) {
    assert.ok(main.includes(text), `missing Chinese desktop system label: ${text}`)
  }

  for (const text of ['群晖 DSM 配置', 'DSM 操作示意图', '上一步', '下一步', '完成']) {
    assert.ok(synologyGuide.includes(text), `missing Chinese Synology guide label: ${text}`)
  }

  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /<title>xDrive 桌面版<\/title>/)
})

test('desktop keeps sync controls global instead of repeating page status actions', () => {
  const start = renderer.indexOf('<header className="topbar">')
  const end = renderer.indexOf('</header>', start)
  assert.notEqual(start, -1, 'missing desktop topbar')
  assert.notEqual(end, -1, 'missing desktop topbar end')
  const topbar = renderer.slice(start, end)

  assert.ok(topbar.includes('<h1>{viewLabel(view)}</h1>'), 'topbar should show the current page title')
  assert.equal(topbar.includes('{headline}'), false, 'topbar should not repeat sync status as the page title')
  assert.ok(topbar.includes('aria-label="同步状态"'), 'missing global sync status capsule')
  assert.ok(topbar.includes('aria-label="立即同步"'), 'missing global sync shortcut')
  assert.ok(topbar.includes('aria-label="更多同步操作"'), 'missing global sync overflow menu')
  assert.ok(renderer.includes('打开同步文件夹'), 'missing global open-folder action')
  assert.ok(renderer.includes('同步已暂停；此设备不会继续后台同步。'), 'missing paused-sync exception banner')
  assert.ok(renderer.includes('发现 {status.conflict_count || 0} 个同步冲突'), 'missing conflict exception banner')
  assert.ok(renderer.includes('同步异常：{status.last_error}'), 'missing sync-error exception banner')
})

test('desktop gates CfAPI-only storage controls by platform', () => {
  assert.ok(renderer.includes("const storagePoliciesSupported = info?.platform === 'win32'"), 'missing Windows storage capability gate')
  assert.ok(renderer.includes('Linux FUSE 模式不提供 Windows CfAPI'), 'missing Linux FUSE storage explanation')
  assert.ok(renderer.includes('FUSE 按需访问'), 'missing Linux read-only storage state')
  assert.ok(renderer.includes("storagePoliciesSupported ? '管理存储' : '查看存储'"), 'missing platform-aware storage action')
})

test('desktop external sources expose safe source deletion', () => {
  assert.ok(renderer.includes('删除来源'), 'missing source delete action')
  assert.ok(renderer.includes('已同步到 xDrive'), 'missing non-destructive delete confirmation prefix')
  assert.ok(renderer.includes('文件会保留，不会删除'), 'missing non-destructive delete confirmation result')
  assert.ok(renderer.includes('window.xdriveDesktop.agent.deleteSource'), 'missing renderer delete bridge call')
})

test('desktop Yike source exposes connection testing', () => {
  assert.ok(renderer.includes('testSourceCredential'), 'missing candidate Cookie test')
  assert.ok(renderer.includes('testStoredSourceCredential'), 'missing stored Cookie test')
  assert.ok(renderer.includes('测试连接'), 'missing Yike connection test action')
})

test('desktop GUI does not regress to key English labels', () => {
  for (const text of [
    'AGENT CONNECTION',
    '>Overview</button>',
    '>Cloud files</button>',
    'TRANSFER CENTER',
    'STORAGE POLICIES',
    'CONFLICT COPIES',
    'CLIENT SETTINGS',
    'Share —',
    'Expires after',
    'Maximum downloads',
    'Password (optional)',
  ]) {
    assert.equal(renderer.includes(text), false, `English desktop GUI label returned: ${text}`)
  }

  for (const text of [
    'Open xDrive Desktop',
    'Open xDrive Folder',
    'Sync Now',
    'Resume Sync',
    'Pause Sync',
    'Quit xDrive Desktop',
    'Choose xDrive sync folder',
  ]) {
    assert.equal(main.includes(text), false, `English desktop system label returned: ${text}`)
  }
})
