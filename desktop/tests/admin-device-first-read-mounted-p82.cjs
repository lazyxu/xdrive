'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')
const deviceValidationExports = (() => {
  // Retain the original mounted page; exercise its actual redacted validator.
  const filename = path.join(root, 'ui/shared/src/device-backup-device-page-validation.ts')
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exported = {}
  new Function('exports', 'require', js)(exported, () => {
    throw Error('Device backup read validator must not import runtime dependencies')
  })
  return exported
})()
// The original renderers schedule a real, non-layout refresh indicator after
// an accepted snapshot. Provide browser timer APIs for the mounted renderer.
globalThis.window = { setTimeout, clearTimeout }
const mui = new Proxy({}, { get: (_target, property) => String(property) })
const shared = new Proxy({}, { get: (_target, name) => String(name) })
function page(file, exportName) {
  const filename = path.join(root, 'ui/shared/src/mui', file)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, name => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (name === '@mui/material') return mui
    if (name.startsWith('@mui/icons-material/')) return { __esModule: true, default: 'Icon' }
    if (name === '../format') return { formatBytes: value => String(value) + ' B' }
    if (name === '../device-backup-visible-folders') return {
      xDriveDeviceBackupVisibleFolders: () => [],
      xDriveDeviceBackupContainsVisibleSource: () => false,
    }
    if (name === '../device-backup-folder-page-validation') return {
      validateXDriveDeviceBackupFolderPage: () => {},
    }
    // P0-C1f also verifies the actual first-overview redaction contract.
    if (name === '../device-backup-device-page-validation') return deviceValidationExports
    if (name === '../device-backup-run-page-validation') return {
      validateXDriveDeviceBackupRunPage: () => {},
    }
    if (name === './WorkspaceSurface') return {
      XDriveWorkspaceSurface: ({ children, pageActions }) =>
        React.createElement('WorkspaceSurface', {}, pageActions, children),
    }
    if (name.startsWith('./')) return new Proxy({}, { get: (_, property) =>
      property === 'xDriveDialogPaperProps' ? {} : String(property),
    })
    throw Error('Unrecognized original page dependency ' + name)
  })
  assert.equal(typeof mod.exports[exportName], 'function')
  return mod.exports[exportName]
}
const Users = page('AdminUsersPage.tsx', 'default')
const Device = page('DeviceBackupPage.tsx', 'XDriveDeviceBackupPage')
function defer() {
  let resolve, reject
  const promise = new Promise((success, fail) => { resolve = success; reject = fail })
  return { promise, resolve, reject }
}
const wait = ms => new Promise(done => setTimeout(done, ms))
const marked = (view, marker) =>
  view.root.findAll(el => Object.prototype.hasOwnProperty.call(el.props ?? {}, marker))
const spinners = view => view.root.findAll(el =>
  (el.type === 'XDriveStatePanel' && el.props.loading) ||
  (el.type === 'CircularProgress'))
// Use the actual loading paths, while the host mocks exclude MUI/layout implementation.
const user = { id: 3, username: 'owner', role: 'admin', disabled: false,
  must_change_password: false, physical_used_bytes: 12, quota_bytes: 0,
  available_bytes: 100, reserved_bytes: 0, logical_file_bytes: 12,
  trash_bytes: 0, history_bytes: 0, over_quota: false }
async function mount(Component, props, fn) {
  let tree
  try {
    await act(async () => { tree = Renderer.create(React.createElement(Component, props)) })
    await fn(tree, async next => act(async () => tree.update(React.createElement(Component, next))))
  } finally {
    if (tree) await act(async () => tree.unmount())
  }
}
test('P82 original Admin Users holds the first authenticated GET silently beyond 360ms', async () => {
  const first = defer(), next = defer(), secondOwner = defer()
  let reads = 0
  const api = { adminUsers: () => (++reads === 1 ? first.promise : next.promise) }
  const api2 = { adminUsers: () => secondOwner.promise }
  await mount(Users, { api, currentUserID: 3, onChanged() {} }, async (v, update) => {
    const cold = () => {
      const nodes = marked(v, 'data-xdrive-admin-users-first-read')
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].props['aria-busy'], 'true')
      assert.equal(nodes[0].props.sx.minHeight, 180)
      assert.equal(spinners(v).length, 0)
    }
    cold()
    await act(async () => { await wait(365) })
    cold()
    await act(async () => { first.resolve([user]); await first.promise })
    assert.equal(marked(v, 'data-xdrive-admin-users-first-read').length, 0)
    assert.equal(marked(v, 'data-xdrive-admin-user-id').length, 1)
    const refresh = v.root.findAll(el => el.type === 'XDriveActionButton' &&
      el.props.children === '刷新')[0]
    await act(async () => { refresh.props.onClick() })
    assert.equal(marked(v, 'data-xdrive-admin-user-id').length, 1,
      'accepted user must remain during same-Owner refresh')
    await act(async () => { await wait(365) })
    assert.equal(marked(v, 'data-xdrive-admin-users-first-read').length, 0)
    assert.equal(spinners(v).length, 0)
    await act(async () => { next.resolve([user]); await next.promise })
    await update({ api: api2, currentUserID: 4, onChanged() {} })
    cold()
    assert.equal(marked(v, 'data-xdrive-admin-user-id').length, 0,
      'previous Owner data must not paint')
    await act(async () => { secondOwner.resolve([]); await secondOwner.promise })
    assert.equal(marked(v, 'data-xdrive-admin-users-first-read').length, 0)
  })
})
test('P82 original Device Backup retains silent 180px first read; real slow accepted refresh remains', async () => {
  const first = defer(), next = defer()
  let reads = 0
  const source = { list: () => (++reads === 1 ? first.promise : next.promise) }
  await mount(Device, { source }, async v => {
    const cold = () => {
      const nodes = marked(v, 'data-xdrive-device-backup-first-read')
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].props['aria-busy'], 'true')
      assert.equal(nodes[0].props.sx.minHeight, 180)
      assert.equal(spinners(v).length, 0)
    }
    cold()
    await act(async () => { await wait(365) })
    cold()
    await act(async () => { first.resolve({ devices: [], has_more: false, has_more_folders: false, next_after_device_id: '' }); await first.promise })
    assert.equal(marked(v, 'data-xdrive-device-backup-first-read').length, 0)
    assert.equal(marked(v, 'data-xdrive-device-backup-overview')[0].props.sx.minHeight, 180,
      'authoritative empty device list keeps the cold-slot height')
    const refresh = v.root.findAll(el => el.type === 'Button' &&
      el.props.children === '刷新')[0]
    assert.ok(refresh, 'original Device Backup refresh button remains')
    await act(async () => { refresh.props.onClick() })
    assert.equal(marked(v, 'data-xdrive-device-backup-first-read').length, 0)
    await act(async () => { await wait(365) })
    assert.equal(marked(v, 'data-xdrive-device-backup-first-read').length, 0)
    assert.equal(spinners(v).length, 0)
    await act(async () => { next.resolve({ devices: [], has_more: false, has_more_folders: false, next_after_device_id: '' }); await next.promise })
  })
})


test('P0-C1f mounted Device Backup rejects private first-read and preserves verified refresh cards', async () => {
  const safe = {
    devices: [{ id: '10000000-0000-4000-8000-000000000001',
      name: 'Verified desktop', platform: 'linux',
      connection_state: 'unknown', revoked: false, folders: [] }],
    has_more: false, has_more_folders: false, next_after_device_id: '',
  }
  const hostile = {
    ...safe, devices: [{ ...safe.devices[0], name: 'Untrusted desktop',
      root_fingerprint: 'PRIVATE-ROOT-FINGERPRINT', local_path: '/secret/private' }],
  }
  const first = defer(), refreshResponse = defer()
  let reads = 0
  const source = { list: () => (++reads === 1 ? first.promise : refreshResponse.promise) }
  const nameCount = (view, value) => view.root.findAll(el =>
    el.type === 'Typography' && el.props.children === value).length
  await mount(Device, { source }, async view => {
    await act(async () => { first.resolve(safe); await first.promise })
    assert.equal(nameCount(view, 'Verified desktop'), 1,
      'valid first overview must paint without requiring a continuation page')
    const refresh = view.root.findAll(el =>
      el.type === 'Button' && el.props.children === '刷新')[0]
    assert.ok(refresh)
    await act(async () => { refresh.props.onClick() })
    await act(async () => { refreshResponse.resolve(hostile); await refreshResponse.promise })
    assert.equal(nameCount(view, 'Verified desktop'), 1,
      'rejected same-source refresh must retain the last verified cards')
    assert.equal(nameCount(view, 'Untrusted desktop'), 0)
    const displayedText = view.root.findAll(el => typeof el.props.children === 'string')
      .map(el => el.props.children).join('|')
    assert.doesNotMatch(displayedText, /PRIVATE-ROOT-FINGERPRINT|\/secret\/private/)
    assert.ok(view.root.findAll(el => el.type === 'XDriveStatusAlert'
      && String(el.props.children).includes('已保留上次成功读取')).length > 0)
  })
  await mount(Device, { source: { list: async () => hostile } }, async view => {
    assert.equal(nameCount(view, 'Untrusted desktop'), 0,
      'malformed cold owner page must not render device cards')
    assert.ok(view.root.findAll(el => el.type === 'XDriveStatePanel'
      && el.props.message === '设备备份信息读取失败，请刷新重试。').length > 0)
  })
})
