const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'web', 'src', 'AdminAudit.tsx'), 'utf8')

test('admin audit keeps VirtualCollection and switches only the row renderer below 900px', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px)')",
    'const auditRowHeight = compactViewport ? 152 : AUDIT_ROW_HEIGHT',
    'const auditHeaderHeight = compactViewport ? 0 : AUDIT_HEADER_HEIGHT',
    'rowHeight: auditRowHeight',
    'headerHeight: auditHeaderHeight',
    'useXDriveVirtualCollection<AuditEvent>',
    'virtualCollection.ensureViewport',
  ]) {
    assert.ok(source.includes(token), 'mobile audit virtualization contract missing: ' + token)
  }
})

test('mobile audit cards preserve before/after spacers and fixed row height', () => {
  for (const token of [
    'data-xdrive-admin-audit-mobile-list',
    'sx={{ height: auditRowHeight',
    'height: virtualWindow.before',
    'height: virtualWindow.after',
    'data-xdrive-admin-audit-placeholder',
    'data-xdrive-admin-audit-row',
  ]) {
    assert.ok(source.includes(token), 'mobile audit row contract missing: ' + token)
  }
})

test('desktop sticky audit table remains available', () => {
  for (const token of [
    '<Table',
    'stickyHeader',
    'aria-label="审计日志"',
    "sx={{ minWidth: 880, tableLayout: 'fixed' }}",
    'AUDIT_ROW_HEIGHT',
    'AUDIT_HEADER_HEIGHT',
  ]) {
    assert.ok(source.includes(token), 'desktop audit table contract missing: ' + token)
  }
})

test('mobile audit cards keep actor, action, target, result and detail action', () => {
  for (const token of [
    'actionLabel(event.action)',
    "event.actor_username || '匿名'",
    'targetLabel + targetSuffix',
    "event.result === 'success' ? 'good' : 'bad'",
    'setDetailEvent(event)',
  ]) {
    assert.ok(source.includes(token), 'mobile audit field missing: ' + token)
  }
})
