const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const main = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const types = read('desktop', 'src', 'renderer', 'global.d.ts')
const explorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const app = read('desktop', 'src', 'renderer', 'App.tsx')

test('Desktop folder download uses one group with one child per leaf file', () => {
  for (const token of [
    'func (c *agentController) CloudDownloadFolder(',
    'c.transfers.StartGroup(transfer.Spec{',
    'transfer.PhaseScanning',
    'scanAgentCloudDownloadFolder(ctx, root, cli.ListPage)',
    'childSpecs := make([]transfer.Spec, len(manifest.Files))',
    'c.transfers.StartChildrenByID(group.ID(), childSpecs)',
    'len(childHandles) != len(childSpecs)',
    'transfer.PhaseQueued',
    'RelativePath:',
    'child.SetPhase(transfer.PhaseTransferring)',
    'child.Baseline(done, total)',
    'child.Progress(done, total)',
    'group.UpdateGroup(groupProgress())',
    'transfer.StatePartial',
    'transfer.StateFailed',
    'transfer.StateCancelled',
  ]) {
    assert.ok(agentCloud.includes(token), 'folder download hierarchy missing: ' + token)
  }
})

test('Desktop folder download uses exact root lookup and paged tree scans', () => {
  for (const token of [
    'agentCloudDownloadChildrenPageLimit = 500',
    'client.ChildrenOptions{',
    'NextCursor',
    'resolveAgentCloudDownloadFolderRoot(ctx, id, parentID, cli.Node)',
    'scanAgentCloudDownloadFolder(ctx, root, cli.ListPage)',
  ]) {
    assert.ok(agentCloud.includes(token), 'folder-download lookup/scan contract missing: ' + token)
  }

  const rootStart = agentCloud.indexOf('func resolveAgentCloudDownloadFolderRoot(')
  const scanStart = agentCloud.indexOf('func scanAgentCloudDownloadFolder(', rootStart)
  const rootSource = agentCloud.slice(rootStart, scanStart)
  assert.ok(rootSource.includes('getNode(ctx, id)'), 'folder root must use one exact node lookup')
  assert.equal(rootSource.includes('visitAgentCloudDownloadChildren('), false, 'folder root lookup must not page siblings')

  const pageStart = agentCloud.indexOf('func visitAgentCloudDownloadChildren(')
  const pageEnd = agentCloud.indexOf('func downloadAgentCloudFileIntoPath(', pageStart)
  const scanSource = agentCloud.slice(pageStart, pageEnd)
  assert.equal(scanSource.includes('func(context.Context, uint64) ([]client.Node, error)'), false, 'legacy unpaged scanner contract must be removed')
  assert.equal(scanSource.includes('.List(ctx,'), false, 'folder-download scan helpers must not use legacy unpaged List')
})

test('folder manifest counts leaf files and preserves empty directories without using archive transport', () => {
  for (const token of [
    'type agentCloudFolderDownloadManifest struct',
    'Directories []string',
    'Files       []agentCloudFolderDownloadFile',
    'manifest.Directories = append(manifest.Directories, relativePath)',
    'manifest.Files = append(manifest.Files',
    'manifest.TotalBytes += node.Size',
    'cli.DownloadToProgress(ctx, id, tmp, progress)',
  ]) {
    assert.ok(agentCloud.includes(token), 'folder download manifest missing: ' + token)
  }
  const folderStart = agentCloud.indexOf('func (c *agentController) CloudDownloadFolder(')
  const archiveStart = agentCloud.indexOf('func (c *agentController) CloudDownloadArchive(')
  const folderSource = agentCloud.slice(folderStart, archiveStart)
  assert.equal(folderSource.includes('DownloadArchiveToProgress'), false, 'Desktop folder download must not download a zip')
  assert.equal(folderSource.includes('extractDownloadedArchive'), false, 'Desktop folder download must not extract an archive')
})

test('Desktop bridges expose dedicated folder tree download capability', () => {
  for (const token of [
    '"folder-download-tree"',
    'CloudDownloadFolder(context.Context, uint64, uint64, string)',
    'POST /v1/cloud/download/folder',
    'cloudDownloadFolder(w http.ResponseWriter',
  ]) {
    assert.ok(agentIPC.includes(token), 'Agent IPC folder-download bridge missing: ' + token)
  }
  assert.ok(agentClient.includes('export type AgentCloudFolderDownloadResult'), 'Electron result type is missing')
  assert.ok(agentClient.includes('cloudDownloadFolder(id: number, parentID: number, destination: string)'), 'AgentClient folder download is missing')
  assert.ok(agentClient.includes("'/v1/cloud/download/folder'"), 'AgentClient folder endpoint is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-download-folder'"), 'Electron main folder download handler is missing')
  assert.ok(main.includes("requireAgentCapability(hello, 'folder-download-tree')"), 'Electron main must capability-gate folder download')
  assert.ok(main.includes("properties: ['openDirectory', 'createDirectory']"), 'folder download must choose a destination directory')
  assert.ok(preload.includes("cloudDownloadFolder: (id: number, parentID: number) =>"), 'preload folder download bridge is missing')
  assert.ok(types.includes('type AgentCloudFolderDownloadResult = {'), 'renderer folder result type is missing')
  assert.ok(types.includes('cloudDownloadFolder: (id: number, parentID: number)'), 'renderer folder download method is missing')
})

test('single folder prefers tree download while single-file and multi-selection compatibility remain', () => {
  for (const token of [
    'folderTreeDownloadSupported = false',
    "nodes.length === 1",
    "nodes[0].type === 'dir'",
    'window.xdriveDesktop.agent.cloudDownloadFolder(',
    "beginActionBusy('download-folder')",
    'folderDownloadSupported={!trashActive && (folderTreeDownloadSupported || archiveDownloadSupported)}',
  ]) {
    assert.ok(explorer.includes(token), 'Desktop folder-download selection missing: ' + token)
  }

  const folderBranch = explorer.indexOf('folderTreeDownloadSupported &&')
  const archiveBranch = explorer.indexOf('if (archiveDownloadSupported)', folderBranch)
  assert.ok(folderBranch >= 0 && archiveBranch > folderBranch, 'single-folder tree download must run before archive fallback')
  assert.ok(explorer.includes('await downloadNode(archivePlan.file)'), 'single-file Save As compatibility was removed')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudDownloadArchive(archivePlan.ids)'), 'multi-selection archive fallback was removed')
  assert.ok(app.includes("capabilities.includes('folder-download-tree')"), 'Desktop App must pass folder tree capability')
})
