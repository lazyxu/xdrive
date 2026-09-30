const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'ShareFields.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ShareDialog.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
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
