const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const publicShare = fs.readFileSync(path.join(repo, 'web', 'src', 'PublicShare.tsx'), 'utf8')
const webStyles = fs.readFileSync(path.join(repo, 'web', 'src', 'styles.css'), 'utf8')
const authSurface = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'AuthSurface.tsx'), 'utf8')
const brandLockup = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'BrandLockup.tsx'), 'utf8')

test('Web public share uses the shared auth and brand surfaces', () => {
  for (const token of [
    'XDriveAuthShell',
    'XDriveAuthPanel',
    'XDriveBrandLockup',
    'iconSrc={xDriveBrandIcon}',
    'variant="large"',
    'subtitle="安全文件分享"',
    '<XDriveAuthShell viewport decorated spacing="compact">',
    '<XDriveAuthPanel size="compact" form onSubmit=',
  ]) {
    assert.ok(publicShare.includes(token), `Public Share shared surface missing: ${token}`)
  }

  for (const legacy of [
    'className="auth-shell"',
    'className="auth-card"',
    'className="brand-lockup"',
    'className="brand-mark"',
    '<Card',
  ]) {
    assert.equal(publicShare.includes(legacy), false, `Public Share legacy surface remains: ${legacy}`)
  }

  assert.equal(webStyles.includes('.auth-shell'), false, 'Web must not restore the removed auth shell CSS')
  assert.equal(webStyles.includes('.auth-card'), false, 'Web must not restore the removed auth card CSS')
  assert.ok(authSurface.includes('export function XDriveAuthShell'), 'shared auth shell must remain available')
  assert.ok(authSurface.includes('export function XDriveAuthPanel'), 'shared auth panel must remain available')
  assert.ok(brandLockup.includes('export function XDriveBrandLockup'), 'shared brand lockup must remain available')
})

test('Web public share keeps native download, password and eligibility feedback', () => {
  for (const token of [
    'api.publicShare(token)',
    'api.downloadPublicShare(token, password, share.name)',
    "setNotice('已交给浏览器下载。')",
    'share.requires_password',
    'placeholder="分享密码"',
    'share.max_downloads > 0',
    '此分享已达到下载上限。',
    'loading={downloading}',
    'disabled={!canDownload}',
  ]) {
    assert.ok(publicShare.includes(token), `Public Share behavior missing: ${token}`)
  }
})


test('Web public share delegates the file stream to a short-lived native ticket', () => {
  const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
  for (const token of [
    '/api/v1/public/share/download-ticket',
    'X-XDrive-Share-Token',
    'xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), filename)',
  ]) {
    assert.ok(api.includes(token), `Public Share native handoff missing: ${token}`)
  }
  const start = api.indexOf('async downloadPublicShare(')
  const end = api.indexOf('downloadURL(nodeID: number)', start)
  const method = api.slice(start, end)
  assert.equal(method.includes('response.blob()'), false)
  assert.equal(method.includes('URL.createObjectURL'), false)
})
