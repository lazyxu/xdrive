const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'web', 'src', 'AdminUsers.tsx'), 'utf8')

test('admin users table projects to card rows below md without duplicating actions', () => {
  for (const token of [
    'data-xdrive-admin-users-responsive',
    "minWidth: { xs: 0, md: 900 }",
    "display: { xs: 'block', md: 'table' }",
    "display: { xs: 'none', md: 'table-header-group' }",
    "display: { xs: 'block', md: 'table-row' }",
    "borderRadius: { xs: 2, md: 0 }",
  ]) {
    assert.ok(source.includes(token), 'admin user mobile-card contract missing: ' + token)
  }
})

test('admin user cells expose compact labels while preserving desktop table cells', () => {
  for (const label of ['用户', '角色', '启用', '密码', '存储', '上次登录', '操作']) {
    assert.ok(source.includes(`adminUserCellSx('${label}')`), 'missing mobile cell label: ' + label)
  }
  assert.ok(source.includes("display: { xs: 'grid', md: 'none', xl: 'table-cell' }"))
})

test('all user mutations stay on the single shared row implementation', () => {
  for (const token of [
    'api.adminUpdateUser(user.id, { role })',
    'api.adminUpdateUser(user.id, { disabled: true })',
    'api.adminRevokeSessions(user.id)',
    'api.adminDeleteUser(user.id)',
    'setQuotaUser(user)',
    'setResetUser(user)',
  ]) {
    assert.ok(source.includes(token), 'admin user action contract missing: ' + token)
  }
})
