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
    // P82 measures first-read geometry, not continuation payload validation.
    // Keep the original mounted component and mock only its pure validator,
    // exactly as the existing folder-page validator is mocked above.
    if (name === '../device-backup-device-page-validation') return {
      validateXDriveDeviceBackupDevicePage: () => {},
    }
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
    await act(async () => { first.resolve({ devices: [] }); await first.promise })
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
    await act(async () => { next.resolve({ devices: [] }); await next.promise })
  })
})
