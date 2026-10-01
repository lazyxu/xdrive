const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'ShareFields.tsx'), 'utf8')
const sharedList = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'ShareList.tsx'), 'utf8')
const sharedDialog = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'ShareDialog.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ShareDialog.tsx'), 'utf8') + sharedDialog
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + sharedDialog
const styles = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Web and Desktop reuse shared share creation fields', () => {
  for (const token of [
    'XDriveCreatedShareLink',
    'XDriveShareCreateFields',
    'datetime-local',
    '有效期',
    '过期时间',
    '最大下载次数',
    '密码（可选）',
    '0 表示不限',
  ]) {
    assert.ok(shared.includes(token), `shared share fields missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveCreatedShareLink\b/g) || []).length, 1, 'Web should reuse shared created-link presentation')
  assert.equal((desktop.match(/<XDriveCreatedShareLink\b/g) || []).length, 1, 'Desktop should reuse shared created-link presentation')
  assert.equal((web.match(/<XDriveShareCreateFields\b/g) || []).length, 1, 'Web should reuse shared share fields')
  assert.equal((desktop.match(/<XDriveShareCreateFields\b/g) || []).length, 1, 'Desktop should reuse shared share fields')

  assert.equal(web.includes('type="datetime-local"'), false, 'Web should not retain local expiry field')
  assert.equal(desktop.includes('className="share-form"'), false, 'Desktop should not retain local share form shell')
  assert.equal(desktop.includes('className="share-created-row"'), false, 'Desktop should not retain local created-share shell')
  assert.equal(styles.includes('.share-form {'), false, 'Desktop should not retain duplicate share form CSS')
  assert.equal(styles.includes('.share-created-row {'), false, 'Desktop should not retain duplicate created-share CSS')
})


test('Web and Desktop reuse shared existing-share list presentation', () => {
  for (const token of [
    'XDriveShareList',
    "variant === 'compact'",
    'XDriveShareStatusBadge',
    'XDriveTableSurface',
    '保护方式',
    '过期时间',
    '下载次数',
    '密码保护',
    '永不过期',
    '撤销',
  ]) {
    assert.ok(sharedList.includes(token), `shared share list missing: ${token}`)
  }

  assert.equal((web.match(/<XDriveShareList\b/g) || []).length, 1, 'Web should reuse shared existing-share list')
  assert.equal((desktop.match(/<XDriveShareList\b/g) || []).length, 1, 'Desktop should reuse shared existing-share list')
  assert.equal(web.includes('shares.map((share)'), false, 'Web should not retain local share mapping')
  assert.equal(desktop.includes('cloudShares.map((share)'), false, 'Desktop should not retain local share mapping')
  assert.ok(desktop.includes('listVariant="compact"'), 'Desktop should preserve compact share-list presentation')
  assert.ok(web.includes('listVariant="table"'), 'Web should preserve table share-list presentation')
})
