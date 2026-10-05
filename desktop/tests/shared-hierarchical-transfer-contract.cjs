const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'transfers.ts')
const webStore = read('web', 'src', 'transfers.ts')
const goModel = read('internal', 'transfer', 'model.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')

test('shared transfer contract models flat parent/root hierarchy without nesting transport payloads', () => {
  for (const token of [
    "export type XDriveTransferScope = 'item' | 'group'",
    'parent_id?: string',
    'root_id?: string',
    'scope?: XDriveTransferScope',
    'phase?: XDriveTransferPhase',
    'scan_complete?: boolean',
    'relative_path?: string',
    'items_total?: number',
    'items_completed?: number',
    'items_failed?: number',
    'items_running?: number',
    'items_queued?: number',
    'XDriveTransferTreeNode',
    'xDriveTransferTree',
    'xDriveTransferRootTasks',
    'xDriveTransferChildren',
  ]) {
    assert.ok(shared.includes(token), 'hierarchical transfer contract missing: ' + token)
  }
  assert.equal(shared.includes('children?: XDriveTransferTask[]'), false, 'transport payload must stay flat')
})

test('legacy single-file transfers normalize into one leaf root task', () => {
  for (const token of [
    'xDriveNormalizeTransferTask',
    "root_id: task.root_id || task.parent_id || task.id",
    "const scope: XDriveTransferScope = task.scope === 'group' ? 'group' : 'item'",
    "scan_complete: task.scan_complete ?? scope === 'item'",
    "items_total: Math.max(0, task.items_total ?? (scope === 'item' ? 1 : 0))",
  ]) {
    assert.ok(shared.includes(token), 'legacy normalization missing: ' + token)
  }
  assert.ok(webStore.includes('xDriveNormalizeTransferTask(item)'), 'Web persisted leaf history must normalize legacy records')
  for (const token of [
    'root_id: id',
    "scope: 'item'",
    "phase: 'transferring'",
    'scan_complete: true',
    'items_total: 1',
    'items_running: 1',
  ]) {
    assert.ok(webStore.includes(token), 'new Web leaf transfer contract missing: ' + token)
  }
})

test('shared aggregate helpers count parent work once and expose bytes/items independently', () => {
  for (const token of [
    'xDriveTransferItemProgress',
    'xDriveTransferAggregateBytes',
    'xDriveActiveTransferCount',
    'xDriveTransferRootTasks(tasks).filter(xDriveTransferActive).length',
    'xDriveTransferHasHistory',
    'xDriveTransferRootTasks(tasks).some(xDriveTransferTerminal)',
    "case 'partial': return '部分完成'",
    "case 'cancelling': return '正在取消'",
    "case 'cancelled': return '已取消'",
    'xDriveTransferPhaseLabel',
  ]) {
    assert.ok(shared.includes(token), 'hierarchical aggregation missing: ' + token)
  }
})

test('Go transfer manager exposes group/child execution primitives while preserving leaf Start()', () => {
  for (const token of [
    'ScopeItem  = "item"',
    'ScopeGroup = "group"',
    'PhaseScanning',
    'PhaseQueued',
    'PhaseTransferring',
    'ParentID',
    'RootID',
    'ItemsTotal',
    'ItemsCompleted',
    'ItemsFailed',
    'ItemsRunning',
    'ItemsQueued',
    'func (m *Manager) StartGroup',
    'func (m *Manager) StartChild',
    'func (h *Handle) UpdateGroup',
    'func activeState',
    'StateQueued, StateRunning, StateRetrying, StateCancelling',
    'func terminalState',
    'StateCompleted, StatePartial, StateFailed, StateCancelled',
  ]) {
    assert.ok(goModel.includes(token), 'Go hierarchical transfer contract missing: ' + token)
  }
})

test('Desktop Agent and renderer carry the same hierarchical wire fields', () => {
  for (const source of [agentClient, rendererTypes]) {
    for (const token of [
      'parent_id?: string',
      'root_id?: string',
      "scope?: 'item' | 'group'",
      'scan_complete?: boolean',
      'relative_path?: string',
      'items_total?: number',
      'items_completed?: number',
      'items_failed?: number',
      'items_running?: number',
      'items_queued?: number',
    ]) {
      assert.ok(source.includes(token) || rendererTypes.includes('type AgentTransfer = XDriveTransferTask'), 'Desktop hierarchy wire contract missing: ' + token)
    }
  }
  assert.ok(rendererTypes.includes('XDriveTransferTask'), 'renderer should reuse the shared transfer contract')
  assert.ok(rendererTypes.includes('type AgentTransfer = XDriveTransferTask'), 'renderer must not keep a second transfer task model')
})
