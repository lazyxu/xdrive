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
    '下载不限次数',
    'const canUpload = canBrowse',
    'loading={downloading}',
    'disabled={!canStartDownload}',
    'const canStartDownload = canDownload && !downloading',
  ]) {
    assert.ok(publicShare.includes(token), `Public Share behavior missing: ${token}`)
  }
  assert.ok(publicShare.includes('const grants = share?.capabilities ?? xDriveShareReadOnlyDefaultCapabilities'))
  assert.ok(publicShare.includes('const canBrowse = shareEligible && grants.list'))
  assert.ok(publicShare.includes('const canPreview = canBrowse && grants.preview'))
  assert.ok(publicShare.includes('const canDownload = canBrowse && grants.download'),
    'Go source grant independently narrows download without removing browse/preview')
  assert.ok(publicShare.includes('const canDownloadZip = canDownload && grants.downloadZip'),
    'Share folder ZIP requires server read-only download+ZIP grants')
  assert.ok(publicShare.includes('const canStartDownload = canDownload && !downloading'),
    'native handoff busy is independent of granted browse/preview')
  assert.ok(!publicShare.includes('const exhausted ='),
    'unlimited shares must not have a download-count eligibility gate')
  assert.ok(!publicShare.includes('达到下载上限'),
    'the public UI must not advertise an obsolete max-download policy')
})



test('Web folder Share stays bounded, read-only and cancels stale page requests', () => {
  const unified = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui',
    'PublicShareUnifiedDirectoryExplorer.tsx'), 'utf8')
  for (const token of [
    "share.type === 'dir'", 'api.publicShareChildren(', 'pendingPage.current?.abort()',
    "document.visibilityState === 'hidden'", "document.addEventListener('visibilitychange', onVisibilityChange)",
    'const controller = new AbortController()', 'items: page.items', 'next: Number(page.nextCursor ?? 0)',
    'await shareFileAdapter.list(', 'hasPreviousPage={Boolean(folder?.history.length)}',
    'hasNextPage={Boolean(folder && folder.next > 0)}', 'onPreviousPage={() => {',
    'onNextPage={() => {',
  ]) assert.ok(publicShare.includes(token), 'folder paging missing: ' + token)
  assert.ok(publicReadOnlyExplorer.includes(
    'return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  for (const token of ['<XDriveFileExplorer', 'data-xdrive-public-share-explorer-workspace',
    'data-xdrive-public-share-explorer-view', 'forceVirtualization',
    'items.slice(0, fileLink ? 1 : sharePageLimit)', 'onOpenFolder?.(entry)',
    'onDownloadItem?.(entry)', 'onPreviousPage', 'onNextPage']) {
    assert.ok(unified.includes(token), 'common Share Core missing: ' + token)
  }
  for (const forbidden of ['onUpload=', 'onDeleteItems=', 'onRenameItem=',
    'onMoveItemsTo=', 'onCopyItemsTo=']) {
    assert.equal(unified.includes(forbidden), false, 'Share may not delegate Owner command: ' + forbidden)
  }
  assert.equal(publicShare.includes('items: [...old.items'), false,
    '100k folder may not accumulate every page into the DOM')
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
    publicShare.indexOf('  const grants ='),
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

test('Anonymous Share upload grants use only scoped HTTP and preserve read-only fallback', () => {
  const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
  const uploadStart = api.indexOf('  publicShareCreateDirectory(')
  const uploadEnd = api.indexOf('  publicShare(token:', uploadStart)
  assert.ok(uploadStart > 0 && uploadEnd > uploadStart, 'dedicated public upload adapter must exist')
  const scoped = api.slice(uploadStart, uploadEnd)
  for (const expected of [
    '/api/v1/public/share/directories', '/api/v1/public/share/uploads',
    '/chunks/${index}', '/finalize',
    'X-XDrive-Share-Token', 'X-XDrive-Share-Password', "'keep_both'",
    'sessionStorage.removeItem(storageKey)',
  ]) assert.ok(scoped.includes(expected), 'required guest upload protocol: ' + expected)
  assert.equal(scoped.includes('/api/v1/nodes/'), false, 'no Owner mutation endpoint in guest uploader')
  assert.equal(scoped.includes('/api/v1/uploads/'), false, 'no authenticated UploadSession route')
  assert.equal(scoped.includes('accessToken'), false, 'no JWT credential leakage')
  assert.ok(publicShare.includes("grants.upload === true"), 'only explicit server grants show guest upload')
  assert.ok(publicShare.includes("canUpload ? '查看 + 上传 · 授权访问' : '只读 · 授权访问'"),
    'the public share titlebar must not claim read-only when guest uploads are granted')
  assert.ok(publicShare.includes('api.uploadPublicShareFile('), 'actual scoped upload client is wired')
  assert.ok(publicShare.includes('api.publicShareCreateDirectory('), 'nested directory creation is wired')
  assert.ok(publicShare.includes('parts') === false || publicShare.includes('const components = relative.split('),
    'relative paths remain explicit segments')
  assert.ok(!publicShare.includes('const exhausted ='), 'no download-count gate')
})
