'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const agent = read('cmd/xdrive-agent/desktop_ipc.go')
const cloud = read('cmd/xdrive-agent/cloud_files.go')
const client = read('desktop/src/main/agent_client.cts')
const main = read('desktop/src/main/index.cts')
const preload = read('desktop/src/preload/index.cts')
const types = read('desktop/src/renderer/global.d.ts')
const model = read('ui/shared/src/cloud-files.ts')
const renderer = read('desktop/src/renderer/DesktopFileExplorer.tsx')

test('U09-D2b native contract forwards only typed authenticated child identity and owner ordering', () => {
  for (const source of [
    'mux.HandleFunc("GET /v1/cloud/children/position", h.cloudChildPosition)',
    'CloudLocateChildPosition(context.Context, uint64, uint64, client.ChildrenPositionOptions)',
    'h.ctrl.CloudLocateChildPosition(r.Context(), parentID, nodeID, client.ChildrenPositionOptions{',
    '"cloud-child-position"',
    'position.NodeID != nodeID', 'position.Revision == 0', 'position.Index < 0',
    'position.Group != expectedGroup', 'position.FoldersFirst != expectedFoldersFirst',
    'w.Header().Set("Cache-Control", "no-store")',
  ]) assert.ok(agent.includes(source), source)
  assert.match(cloud, /return cli\.LocateChildPosition\(ctx, parentID, nodeID, options\)/)
  assert.ok(client.includes('cloudChildPosition('))
  assert.ok(client.includes("this.request<AgentCloudChildrenPosition>("))
  assert.ok(client.includes("/v1/cloud/children/position?"))
  assert.ok(preload.includes("'agent:cloud-child-position'"))
  assert.ok(types.includes('type AgentCloudChildrenPosition = XDriveCloudFilesPosition'))
  assert.ok(model.includes('xDriveCloudFilesPositionMatchesRequest('))
  assert.ok(!renderer.includes('/children/position?'), 'Renderer must never bypass Agent with a raw request')
})

test('U09-D2b Desktop cancel ID is owned by existing viewport request manager', () => {
  const target = main.slice(main.indexOf("ipcMain.handle('agent:cloud-child-position'"),
    main.indexOf("ipcMain.handle('agent:cloud-changes'"))
  assert.ok(target.startsWith("ipcMain.handle('agent:cloud-child-position'"))
  for(const guard of [
    'viewportRequests.run(event.sender, requestID, async (signal)',
    "requireAgentCapability(hello, 'cloud-child-position')",
    'Number.isSafeInteger(parentID)', 'Number.isSafeInteger(nodeID)',
    'normalizeFileExplorerGrouping(groupingValue)', 'if (signal?.aborted)',
    'cloudChildPosition(', 'grouping, signal',
    'position.node_id !== nodeID', 'Number.isSafeInteger(position.revision)',
    'position.group !== grouping.groupBy', 'position.folders_first !== grouping.foldersFirst',
  ]) assert.ok(target.includes(guard), guard)
  assert.ok(main.includes("viewportRequests.cancel(event.sender, requestID)"))
  assert.ok(types.includes('requestID?: string,'))
})
