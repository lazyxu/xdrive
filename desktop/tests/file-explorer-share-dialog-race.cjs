const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  const react = {
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (nextValue) => {
        const current = slots[index].value
        slots[index].value = typeof nextValue === 'function' ? nextValue(current) : nextValue
      }
      return [slots[index].value, setValue]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { deps: deps ? [...deps] : undefined, value: callback }
      }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        pendingEffects.push({ index, effect, deps: deps ? [...deps] : undefined })
      }
    },
  }

  return {
    react,
    render(factory) {
      cursor = 0
      pendingEffects = []
      const result = factory()
      for (const pending of pendingEffects) {
        const previous = slots[pending.index]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        const cleanup = pending.effect()
        slots[pending.index] = {
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadShareDialog(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'ShareDialog.tsx',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText

  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === 'react/jsx-runtime') {
      return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    }
    if (request === '@mui/icons-material/LinkRounded') return () => null
    if (request === '@mui/material') {
      return { Box: 'Box', Dialog: 'Dialog', LinearProgress: 'LinearProgress' }
    }
    if (request === './ActionButton') return { XDriveActionButton: 'XDriveActionButton' }
    if (request === './DialogActions') return { XDriveDialogActions: 'XDriveDialogActions' }
    if (request === './DialogContent') return { XDriveDialogContent: 'XDriveDialogContent' }
    if (request === './DialogTitle') {
      return {
        XDriveDialogTitle: 'XDriveDialogTitle',
        xDriveDialogPaperProps: {},
        useXDriveCompactTouchDialog: () => ({
          compactTouch: false,
          dialogPaper: {},
        }),
      }
    }
    if (request === './FeedbackSnackbar') return { XDriveFeedbackSnackbar: 'XDriveFeedbackSnackbar' }
    if (request === './SectionHeader') return { XDriveSectionHeader: 'XDriveSectionHeader' }
    if (request === './ShareFields') {
      return {
        XDriveCreatedShareLink: 'XDriveCreatedShareLink',
        XDriveShareCreateFields: 'XDriveShareCreateFields',
      }
    }
    if (request === './ShareList') return { XDriveShareList: 'XDriveShareList' }
    if (request === './StatePanel') return { XDriveStatePanel: 'XDriveStatePanel' }
    if (request === './StatusAlert') return { XDriveStatusAlert: 'XDriveStatusAlert' }
    return require(request)
  }

  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.XDriveShareDialog
}

function findElement(value, predicate) {
  if (value === null || value === undefined || typeof value !== 'object') return null
  if (predicate(value)) return value
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (value.props) {
    for (const child of Object.values(value.props)) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return null
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('older ShareDialog list load cannot overwrite a newer node dialog', async () => {
  const runtime = createHookRuntime()
  const ShareDialog = loadShareDialog(runtime.react)

  const nodeA = { id: 1, name: 'A.txt' }
  const nodeB = { id: 2, name: 'B.txt' }
  const shareA = {
    id: 101,
    status: 'active',
    created_at: '2026-10-07T00:00:00Z',
    has_password: false,
    expires_at: null,
    max_downloads: 0,
    download_count: 0,
  }
  const shareB = {
    id: 202,
    status: 'active',
    created_at: '2026-10-07T00:01:00Z',
    has_password: false,
    expires_at: null,
    max_downloads: 0,
    download_count: 0,
  }

  let currentNode = nodeA
  let releaseA
  let releaseB

  const adapter = {
    listShares: (nodeID) => new Promise((resolve) => {
      if (nodeID === nodeA.id) releaseA = () => resolve([shareA])
      else if (nodeID === nodeB.id) releaseB = () => resolve([shareB])
      else throw new Error('unexpected node')
    }),
    createShare: async () => ({ url: 'https://example.invalid/share' }),
    revokeShare: async () => undefined,
  }
  const errors = []
  const onError = (error) => errors.push(error)
  const render = () => runtime.render(() => ShareDialog({
    adapter,
    node: currentNode,
    onClose: () => {},
    onError,
  }))

  render()
  await flushAsync()
  assert.equal(typeof releaseA, 'function')

  currentNode = nodeB
  render()
  await flushAsync()
  assert.equal(typeof releaseB, 'function')

  releaseB()
  await flushAsync()
  let tree = render()
  let title = findElement(tree, (element) => element.type === 'XDriveDialogTitle')
  let list = findElement(tree, (element) => element.type === 'XDriveShareList')
  assert.equal(title?.props?.title, '分享 — B.txt')
  assert.deepEqual(list?.props?.shares?.map((share) => share.id), [shareB.id])

  releaseA()
  await flushAsync()
  tree = render()
  title = findElement(tree, (element) => element.type === 'XDriveDialogTitle')
  list = findElement(tree, (element) => element.type === 'XDriveShareList')

  assert.equal(title?.props?.title, '分享 — B.txt')
  assert.deepEqual(
    list?.props?.shares?.map((share) => share.id),
    [shareB.id],
    'a late ShareDialog response for A must not replace the newer B share list',
  )
  assert.equal(errors.length, 0)
})


test('stale ShareDialog create cannot publish A link or reload A after switching to B', async () => {
  const runtime = createHookRuntime()
  const ShareDialog = loadShareDialog(runtime.react)

  const nodeA = { id: 1, name: 'A.txt' }
  const nodeB = { id: 2, name: 'B.txt' }
  const shareA = {
    id: 101,
    status: 'active',
    created_at: '2026-10-07T00:00:00Z',
    has_password: false,
    expires_at: null,
    max_downloads: 0,
    download_count: 0,
  }
  const shareB = {
    id: 202,
    status: 'active',
    created_at: '2026-10-07T00:01:00Z',
    has_password: false,
    expires_at: null,
    max_downloads: 0,
    download_count: 0,
  }

  let currentNode = nodeA
  let releaseCreateA
  const adapter = {
    listShares: async (nodeID) => nodeID === nodeA.id ? [shareA] : [shareB],
    createShare: (nodeID) => {
      assert.equal(nodeID, nodeA.id)
      return new Promise((resolve) => {
        releaseCreateA = () => resolve({ url: 'https://example.invalid/a-token' })
      })
    },
    revokeShare: async () => undefined,
  }
  const errors = []
  const render = () => runtime.render(() => ShareDialog({
    adapter,
    node: currentNode,
    onClose: () => {},
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let tree = render()
  let list = findElement(tree, (element) => element.type === 'XDriveShareList')
  assert.deepEqual(list?.props?.shares?.map((share) => share.id), [shareA.id])

  const form = findElement(tree, (element) => (
    element.type === 'Box' &&
    element.props?.component === 'form' &&
    typeof element.props?.onSubmit === 'function'
  ))
  assert.ok(form, 'missing share create form')
  form.props.onSubmit({ preventDefault() {} })
  await flushAsync()
  assert.equal(typeof releaseCreateA, 'function')

  currentNode = nodeB
  render()
  await flushAsync()
  tree = render()
  let title = findElement(tree, (element) => element.type === 'XDriveDialogTitle')
  list = findElement(tree, (element) => element.type === 'XDriveShareList')
  assert.equal(title?.props?.title, '分享 — B.txt')
  assert.deepEqual(list?.props?.shares?.map((share) => share.id), [shareB.id])
  assert.equal(
    findElement(tree, (element) => element.type === 'XDriveCreatedShareLink'),
    null,
  )

  releaseCreateA()
  await flushAsync()
  await flushAsync()
  tree = render()
  title = findElement(tree, (element) => element.type === 'XDriveDialogTitle')
  list = findElement(tree, (element) => element.type === 'XDriveShareList')

  assert.equal(title?.props?.title, '分享 — B.txt')
  assert.deepEqual(
    list?.props?.shares?.map((share) => share.id),
    [shareB.id],
    'a stale A create completion must not run its captured load(A) after the dialog moved to B',
  )
  assert.equal(
    findElement(tree, (element) => element.type === 'XDriveCreatedShareLink'),
    null,
    'a stale A create completion must not publish its one-time token into the B dialog',
  )
  assert.equal(errors.length, 0)
})

test('stale ShareDialog revoke cannot reload A after switching to B', async () => {
  const runtime = createHookRuntime()
  const ShareDialog = loadShareDialog(runtime.react)

  const nodeA = { id: 1, name: 'A.txt' }
  const nodeB = { id: 2, name: 'B.txt' }
  const shareA = {
    id: 101,
    status: 'active',
    created_at: '2026-10-07T00:00:00Z',
    has_password: false,
    expires_at: null,
    max_downloads: 0,
    download_count: 0,
  }
  const shareB = {
    id: 202,
    status: 'active',
    created_at: '2026-10-07T00:01:00Z',
    has_password: false,
    expires_at: null,
    max_downloads: 0,
    download_count: 0,
  }

  let currentNode = nodeA
  let releaseRevokeA
  const adapter = {
    listShares: async (nodeID) => nodeID === nodeA.id ? [shareA] : [shareB],
    createShare: async () => ({ url: 'https://example.invalid/unused' }),
    revokeShare: (shareID) => {
      assert.equal(shareID, shareA.id)
      return new Promise((resolve) => {
        releaseRevokeA = resolve
      })
    },
  }
  const errors = []
  const render = () => runtime.render(() => ShareDialog({
    adapter,
    node: currentNode,
    onClose: () => {},
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let tree = render()
  let list = findElement(tree, (element) => element.type === 'XDriveShareList')
  assert.deepEqual(list?.props?.shares?.map((share) => share.id), [shareA.id])

  list.props.onRevoke(shareA)
  await flushAsync()
  assert.equal(typeof releaseRevokeA, 'function')

  currentNode = nodeB
  render()
  await flushAsync()
  tree = render()
  let title = findElement(tree, (element) => element.type === 'XDriveDialogTitle')
  list = findElement(tree, (element) => element.type === 'XDriveShareList')
  assert.equal(title?.props?.title, '分享 — B.txt')
  assert.deepEqual(list?.props?.shares?.map((share) => share.id), [shareB.id])

  releaseRevokeA()
  await flushAsync()
  await flushAsync()
  tree = render()
  title = findElement(tree, (element) => element.type === 'XDriveDialogTitle')
  list = findElement(tree, (element) => element.type === 'XDriveShareList')

  assert.equal(title?.props?.title, '分享 — B.txt')
  assert.deepEqual(
    list?.props?.shares?.map((share) => share.id),
    [shareB.id],
    'a stale A revoke completion must not run its captured load(A) after the dialog moved to B',
  )
  assert.equal(errors.length, 0)
})
