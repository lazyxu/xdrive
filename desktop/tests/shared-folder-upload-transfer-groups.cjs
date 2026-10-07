const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'mui', 'FileExplorerUploadController.ts')
const webStore = read('web', 'src', 'transfers.ts')
const webApi = read('web', 'src', 'api.ts')
const webApp = read('web', 'src', 'App.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentController = read('cmd', 'xdrive-agent', 'controller.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')

test('shared upload controller owns folder group and child lifecycle', () => {
  for (const token of [
    'XDriveFileExplorerUploadTransferLifecycle',
    'startGroup:',
    'startChild:',
    'begin:',
    'progress:',
    'updateGroup:',
    'finish:',
    'const runGroup = async',
    "| 'completed'",
    "| 'partial'",
    "| 'failed'",
    "| 'cancelled'",
    'runTargets,',
    'runGroup,',
  ]) {
    assert.ok(controller.includes(token), 'shared group upload lifecycle missing: ' + token)
  }

  const startGroup = controller.indexOf('groupID = await transferLifecycle.startGroup')
  const resolveTargets = controller.indexOf('targets = await resolveTargets()', startGroup)
  const startChild = controller.indexOf('transferLifecycle.startChild(groupID', resolveTargets)
  const beginGroup = controller.indexOf('transferLifecycle.begin(groupID', startChild)
  assert.ok(startGroup >= 0, 'folder group must be created before scanning')
  assert.ok(resolveTargets > startGroup, 'directory resolution must happen after group creation')
  assert.ok(startChild > resolveTargets, 'children must be created after scan/target resolution')
  assert.ok(beginGroup > startChild, 'all queued children must exist before the group begins transferring')

  assert.ok(controller.includes('for (let index = stoppedAt; index < childIDs.length; index += 1)'), 'cancel/fatal flow must close remaining queued children')
  assert.ok(controller.includes("await finishQuietly(childID, { state: 'cancelled' })"), 'remaining children must become cancelled')
  assert.ok(controller.includes('await transferLifecycle.finish(id, input)'), 'best-effort child cleanup must still terminate the transfer lifecycle')
  assert.ok(controller.includes('aggregate.failed > 0'), 'partial group state must be derived centrally')
})

test('leaf and group transfer speeds use the correct source', () => {
  const center = read('ui', 'shared', 'src', 'mui', 'TransferCenter.tsx')
  const groupStart = center.indexOf('function TransferGroupItem')
  assert.ok(groupStart > 0, 'group component is missing')
  const leafSource = center.slice(0, groupStart)
  const groupSource = center.slice(groupStart)
  assert.ok(leafSource.includes('formatBytesPerSecond(item.instant_bytes_per_second)'), 'leaf instant speed must use the leaf task')
  assert.ok(leafSource.includes('formatBytesPerSecond(item.average_bytes_per_second)'), 'leaf average speed must use the leaf task')
  assert.ok(groupSource.includes('const childInstantSpeed = children.reduce('), 'group instant speed must aggregate children')
  assert.ok(groupSource.includes('const childAverageSpeed = children.reduce('), 'group average speed must aggregate children')
  assert.ok(groupSource.includes('label="当前速度">{formatBytesPerSecond(instantSpeed)}'), 'group UI must render aggregate instant speed')
  assert.ok(groupSource.includes('label="平均速度">{formatBytesPerSecond(averageSpeed)}'), 'group UI must render aggregate average speed')
})

test('completed skipped children count as processed group bytes without inventing transfer speed', () => {
  const sharedTransfers = read('ui', 'shared', 'src', 'transfers.ts')
  const goModel = read('internal', 'transfer', 'model.go')

  assert.ok(sharedTransfers.includes("child.state === 'completed' && child.percent >= 100"), 'group processed bytes must count completed skipped children')
  assert.ok(sharedTransfers.includes('Math.max(childDone, childTotal)'), 'completed child aggregate must advance to its full processed size')
  assert.ok(goModel.includes('e.task.BytesDone = 0'), 'skipped leaf must keep zero actually transferred bytes')
  assert.ok(goModel.includes('e.task.InstantBytesPerSecond = 0'), 'skipped leaf must not invent instant speed')
  assert.ok(goModel.includes('e.task.AverageBytesPerSecond = 0'), 'skipped leaf must not invent average speed')
})

test('single-file upload remains compatible while folder upload uses managed children', () => {
  assert.ok(controller.includes('const runTargets = async'), 'legacy flat runTargets must remain')
  assert.ok(webApi.includes('const managedExternally = Boolean(transferID)'), 'Web upload must distinguish managed children')
  assert.ok(webApi.includes('const activeTransferID = transferID || webTransferStore.create({'), 'single Web upload must still create its own transfer')
  assert.ok(webApi.includes('if (!managedExternally) webTransferStore.complete('), 'managed Web child must not be completed twice')

  assert.ok(agentCloud.includes('CloudUploadWithConflictPolicy('), 'legacy Agent upload method must remain')
  assert.ok(agentCloud.includes('CloudUploadWithConflictPolicyTracked('), 'tracked Agent child upload method is missing')
  assert.ok(agentCloud.includes('managedExternally := transferID != ""'), 'Agent upload must reuse an existing child when provided')
  assert.ok(agentCloud.includes('c.transfers.Handle(transferID)'), 'Agent tracked upload must bind to the child transfer id')
  assert.ok(agentCloud.includes('if !managedExternally {'), 'legacy Agent upload must still own standalone completion')
})

test('folder upload label derivation is shared instead of duplicated in Web/Desktop', () => {
  const web = read('web', 'src', 'App.tsx')
  for (const source of [web, desktopExplorer]) {
    assert.ok(source.includes('xDriveFileExplorerUploadGroupLabel('), 'folder upload group label must use the shared helper')
    assert.equal(source.includes(".split('/')"), false, 'platform adapters must not duplicate folder-root path splitting')
  }
  assert.ok(controller.includes('export function xDriveFileExplorerUploadGroupLabel'), 'shared folder upload label helper is missing')
  assert.ok(controller.includes("normalized.indexOf('/')"), 'shared folder upload label helper must own path segmentation')
})

test('Web folder upload persists one group with queued children', () => {
  for (const token of [
    'startGroup(input:',
    'startChild(groupID:',
    'scope: \'group\'',
    'scope: \'item\'',
    "phase: 'scanning'",
    "phase: 'queued'",
    'parent_id: groupID',
    'root_id: parent.root_id || parent.id',
    'updateGroup(id: string',
    'finishLifecycle(',
  ]) {
    assert.ok(webStore.includes(token), 'Web hierarchical transfer store missing: ' + token)
  }

  for (const token of [
    'transferLifecycle: {',
    'startGroup: (input) => api.startTransferGroup(input)',
    'startChild: (groupID, input) => api.startTransferChild(groupID, input)',
    'fileUploads.runGroup({',
    'itemsTotal: entries.length',
    'bytesTotal: entries.reduce',
    'relativePath,',
  ]) {
    assert.ok(webApp.includes(token), 'Web folder group adapter missing: ' + token)
  }
})

test('Desktop folder upload uses Agent transfer lifecycle instead of duplicate root transfers', () => {
  for (const token of [
    '"transfer-lifecycle"',
    'POST /v1/transfers/lifecycle',
    'StartTransferGroup(',
    'StartTransferChild(',
    'BeginTransfer(',
    'ProgressTransfer(',
    'UpdateTransferGroup(',
    'FinishTransfer(',
  ]) {
    assert.ok(agentIPC.includes(token), 'Agent lifecycle IPC missing: ' + token)
  }

  for (const token of [
    'StartTransferGroup(spec transfer.Spec)',
    'StartTransferChild(parentID string, spec transfer.Spec)',
    'c.transfers.Handle(id)',
    'handle.Finish(state, finishErr)',
  ]) {
    assert.ok(agentController.includes(token), 'Agent lifecycle controller missing: ' + token)
  }

  assert.ok(agentClient.includes('transferLifecycle(input: AgentTransferLifecycleInput)'), 'Electron Agent client lifecycle method is missing')
  assert.ok(desktopMain.includes("ipcMain.handle('agent:transfer-lifecycle'"), 'Electron main lifecycle bridge is missing')
  assert.ok(preload.includes('transferLifecycle: (input: unknown)'), 'preload lifecycle bridge is missing')
  assert.ok(rendererTypes.includes('transferLifecycle: (input: AgentTransferLifecycleInput)'), 'renderer lifecycle bridge type is missing')

  for (const token of [
    'transferLifecycleSupported = false',
    'runGroup: runUploadGroup',
    'transferLifecycle: transferLifecycleSupported ? {',
    "action: 'start_group'",
    "action: 'start_child'",
    "action: 'update_group'",
    "action: 'finish'",
    'cloudUploadFile(',
    'transferID,',
    'runUploadGroup({',
  ]) {
    assert.ok(desktopExplorer.includes(token), 'Desktop folder group adapter missing: ' + token)
  }
  assert.ok(desktopApp.includes("capabilities.includes('transfer-lifecycle')"), 'Desktop must capability-gate hierarchical upload')
})


function loadUploadController(react) {
  const ts = require('typescript')
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerUploadController.ts',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const mod = { exports: {} }
  let batchActive = false
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../upload-conflicts') {
      return {
        xDriveUploadBatchSummary: () => '',
        xDriveUploadConflictCanOverwrite: () => false,
      }
    }
    if (request === './UploadConflictDialog') {
      return {
        useXDriveUploadConflictResolver: () => ({
          beginBatch() {
            if (batchActive) return false
            batchActive = true
            return true
          },
          endBatch() {
            batchActive = false
          },
          resolveConflict: async () => 'cancel',
          dialogProps: {},
        }),
      }
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerUploadController
}

function createUploadHookRuntime() {
  const slots = []
  let cursor = 0
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
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue
      }
      return [slots[index].value, setValue]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
      return slots[index].value
    },
  }
  return {
    react,
    render(factory) {
      cursor = 0
      return factory()
    },
  }
}

test('folder upload group creation is synchronously fenced before transfer lifecycle starts', async () => {
  const runtime = createUploadHookRuntime()
  const useUploadController = loadUploadController(runtime.react)
  let startGroupCalls = 0
  let releaseFirstGroup
  const firstGroupGate = new Promise((resolve) => {
    releaseFirstGroup = resolve
  })

  const transferLifecycle = {
    async startGroup() {
      startGroupCalls += 1
      if (startGroupCalls === 1) await firstGroupGate
      return 'group-' + startGroupCalls
    },
    async startChild() {
      throw new Error('empty folder race test must not create children')
    },
    async begin() {},
    async progress() {},
    async updateGroup() {},
    async finish() {},
  }

  const render = () => runtime.render(() => useUploadController({
    fileName: (file) => file.name,
    fileSize: () => 0,
    preflight: async () => ({ conflict: false }),
    upload: async () => ({ skipped: false }),
    transferLifecycle,
    onError: (error) => { throw error },
    onFeedback: () => {},
  }))

  const uploadController = render()
  const first = uploadController.runGroup({
    label: 'Folder',
    itemsTotal: 0,
    bytesTotal: 0,
    resolveTargets: async () => [],
  })
  const duplicate = uploadController.runGroup({
    label: 'Folder',
    itemsTotal: 0,
    bytesTotal: 0,
    resolveTargets: async () => [],
  })

  await Promise.resolve()
  await Promise.resolve()

  assert.equal(
    startGroupCalls,
    1,
    'same-tick folder uploads must not create duplicate transfer groups before React rerenders',
  )

  releaseFirstGroup()
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
  assert.equal(firstResult.started, true)
  assert.equal(duplicateResult.started, false)
})
