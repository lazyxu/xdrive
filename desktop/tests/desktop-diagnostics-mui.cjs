const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const page = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopDiagnosticsPage.tsx'), 'utf8')
const app = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Desktop diagnostics defaults to a Chinese user summary and hides healthy technical checks', () => {
  for (const token of [
    '系统总体正常',
    '需要注意',
    '重新诊断',
    '更多诊断操作',
    '打开日志',
    '导出诊断报告',
    '技术检查详情',
    "diagnostics.checks.filter((check) => check.status !== 'PASS')",
    "PASS: { label: '正常'",
    "WARN: { label: '需注意'",
    "FAIL: { label: '异常'",
    "'update metadata': '更新检查'",
    "'disk space': '磁盘空间'",
    "'CfAPI sync root': 'Windows 同步根目录'",
    '暂时无法确认是否有新版本',
    'Windows 云文件集成状态异常',
    '查看本地存储',
    '修复同步根目录',
    '重启后台服务',
    '技术信息：{check.detail}',
  ]) {
    assert.ok(page.includes(token), `Desktop diagnostics presentation missing: ${token}`)
  }

  assert.ok(app.includes("onOpenStorage={() => setView('local-storage')}"), 'disk-space warning must navigate to local storage')
  assert.equal(page.includes('<XDriveMetricGrid>'), false, 'diagnostics must not lead with pass/warn/fail metric cards')
  assert.equal(page.includes('label={check.status}'), false, 'raw PASS/WARN/FAIL labels must not be shown')
})

test('Desktop diagnostics uses MUI layout instead of legacy diagnostic CSS', () => {
  for (const token of [
    'Accordion',
    'AccordionSummary',
    'AccordionDetails',
    'IconButton',
    '<Menu',
    '<MenuItem',
    '<Paper',
    'variant="outlined"',
    '<XDriveStatusBadge',
    'variant="body2"',
    'variant="caption"',
  ]) {
    assert.ok(page.includes(token), `Desktop diagnostics MUI layout missing: ${token}`)
  }

  for (const legacy of [
    'className="diagnostics-panel"',
    'className="diagnostic-actions"',
    'className="diagnostic-list"',
    'className="diagnostic-row"',
  ]) {
    assert.equal(page.includes(legacy), false, `legacy diagnostics wrapper remains: ${legacy}`)
  }

  for (const selector of [
    '.diagnostics-panel {',
    '.diagnostic-actions {',
    '.diagnostic-list {',
    '.diagnostic-row {',
    '.diagnostic-row strong',
    '.diagnostic-row p',
  ]) {
    assert.equal(styles.includes(selector), false, `legacy diagnostics CSS remains: ${selector}`)
  }
})
