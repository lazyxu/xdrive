const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const publicShare = fs.readFileSync(path.join(repo, 'web', 'src', 'PublicShare.tsx'), 'utf8')
const publicReadOnlyExplorer = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'PublicShareReadOnlyExplorer.tsx'), 'utf8')
const webStyles = fs.readFileSync(path.join(repo, 'web', 'src', 'styles.css'), 'utf8')
const authSurface = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'AuthSurface.tsx'), 'utf8')
const brandLockup = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'BrandLockup.tsx'), 'utf8')

test('Web public share uses the shared auth and brand surfaces', () => {
  for (const token of [
    'XDriveAuthShell',
    'XDriveAuthPanel',
    'XDriveBrandLockup',
    'iconSrc={xDriveBrandIcon}',
    'variant="titlebar"',
    'subtitle="安全文件分享"',
    '<XDriveAuthShell viewport spacing="compact"',
    '<XDriveAuthPanel size="compact" maxWidth="100%" form onSubmit=',
  ]) {
    assert.ok(publicShare.includes(token), `Public Share shared surface missing: ${token}`)
  }

  for (const cap of [
    'data-xdrive-public-share-titlebar',
    'data-xdrive-public-share-workspace',
    "maxWidth: 1500",
    "minHeight: '100dvh'",
  ]) assert.ok(publicShare.includes(cap), 'public share full-width workspace contract missing: ' + cap)
  assert.equal(publicShare.includes('maxWidth={920}'), false,
    'do not restore the old narrow login card')

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
    'api.publicShare(token, controller.signal)',
    'api.downloadPublicShare(token, password, entry?.name ?? share.name, entry?.id)',
    "setNotice('已交给浏览器下载。')",
    'share.requires_password',
    'placeholder="分享密码"',
    'share.max_downloads > 0',
    '此分享已达到下载上限。',
    'loading={downloading}',
    'disabled={!canStartDownload}',
    'const canStartDownload = canDownload && !downloading',
  ]) {
    assert.ok(publicShare.includes(token), `Public Share behavior missing: ${token}`)
  }
  assert.ok(publicShare.includes('const canDownload = !!share && !exhausted'),
    'download eligibility and browsing must remain independent of pending native handoff')
  assert.ok(!publicShare.includes('!downloading && !exhausted'),
    'native handoff activity must not revoke the UI browse/preview grant')
})


test('Web folder share stays bounded, read-only and cancels stale page requests', () => {
  for (const token of [
    "share.type === 'dir'",
    'api.publicShareChildren(',
    'pendingPage.current?.abort()',
    "document.visibilityState === 'hidden'",
    "document.addEventListener('visibilitychange', onVisibilityChange)",
    'const controller = new AbortController()',
    'items: page.items',
    'next: Number(page.nextCursor ?? 0)',
    'await shareFileAdapter.list(',
    'hasPreviousPage={Boolean(folder?.history.length)}',
    'hasNextPage={Boolean(folder && folder.next > 0)}',
    'onPreviousPage={() => {',
    'onNextPage={() => {',
  ]) {
    assert.ok(publicShare.includes(token), `Shared folder pagination missing: ${token}`)
  }
  for (const token of [
    'const pageItems = items.slice(0, 100)',
    'visibleItems.map(entry => (',
    'data-xdrive-public-share-explorer-workspace',
    'data-xdrive-public-share-details-header',
    'anchorPosition={contextMenu',
    'data-xdrive-public-share-folder-browser',
    'data-xdrive-public-share-explorer-view',
    'onOpenFolder?.(entry)',
    'onDownloadItem?.(entry)',
    'role="listitem"',
  ]) {
    assert.ok(publicReadOnlyExplorer.includes(token), 'shared read-only Explorer presentation missing: ' + token)
  }
  for (const forbidden of ['onUpload', 'onDeleteItems', 'onRenameItem', 'onMoveItemsTo', 'onCopyItemsTo']) {
    assert.equal(publicReadOnlyExplorer.includes(forbidden), false, 'public share must not delegate Owner command: ' + forbidden)
  }
  assert.equal(publicShare.includes('items: [...old.items'), false, '100k folder must not accumulate every page in the DOM')
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


test('SH-P002 first public metadata GET owns an abortable request, not a durable download', () => {
  const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
  const a = api.indexOf('  publicShare(token: string, signal?: AbortSignal) {')
  const b = api.indexOf('  publicShareChildren(', a)
  assert.ok(a >= 0 && b > a, 'shared Web/Mobile transport needs metadata request AbortSignal')
  const getter = api.slice(a, b)
  assert.ok(getter.includes("'/api/v1/public/share'"))
  assert.ok(getter.includes('signal,'), 'the actual fetch RequestInit must carry the signal')
  const first = publicShare.slice(
    publicShare.indexOf('  useEffect(() => {\n    let active = true'),
    publicShare.indexOf('  const exhausted ='),
  )
  assert.ok(first.includes('const controller = new AbortController()'))
  assert.ok(first.includes('api.publicShare(token, controller.signal)'))
  assert.ok(first.includes('if (!active || controller.signal.aborted) return'))
  const cleanup = first.slice(first.lastIndexOf('    return () => {'))
  assert.ok(cleanup.includes('active = false'), 'metadata effect must fence stale completion')
  assert.ok(cleanup.includes('controller.abort()'), 'metadata request must abort on teardown')
  assert.ok(cleanup.includes('pendingPage.current?.abort()'), 'first folder page must abort on teardown')
  assert.ok(cleanup.includes('pendingPage.current = null'), 'an aborted page cannot retain request ownership')
  assert.equal(cleanup.includes('zipPollRef.current?.abort()'), false,
    'share-token teardown must not cancel the user-owned durable ZIP preparation')
  assert.ok(publicShare.includes('api.downloadPublicShare(token, password, entry?.name ?? share.name, entry?.id)'),
    'do not cancel a user-started native download from metadata teardown')
})
