'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('cmd/server/pwa_s4d3b2_actual_server_restart_integration_test.go')
const workflow = read('.github/workflows/pwa-s4d3b2-real-binary-restart.yml')
const delivery = read('docs/pwa-delivery.md')

test('S4D3-B2 real binary: production main process, real SQL partial mutation rollback', () => {
  for (const marker of [
    'exec.Command(binary)', 'migrate(scopedDB)',
    'old := launch()', 'seedAPI.Router()', 'http.MethodPost', '"/api/v1/file-operations"',
    'old.cmd.Process.Signal(syscall.SIGSTOP)', 'old.cmd.Process.Signal(syscall.SIGCONT)',
    'State:\\tT',
    'firstID := enqueue(nodes[0], nodes[1])', 'secondID := enqueue(nodes[2])',
    'CREATE TABLE pwa_s4d3b2_second_delete_gate',
    "RETURNS trigger LANGUAGE plpgsql AS '",
    'AFTER UPDATE OF deleted_at ON xd_nodes',
    'WHEN (NEW.id = %d AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)',
    'PERFORM 1 FROM pwa_s4d3b2_second_delete_gate WHERE id = 1 FOR UPDATE',
    'SELECT id FROM pwa_s4d3b2_second_delete_gate WHERE id = 1 FOR UPDATE',
    'first.CurrentItem == nodes[1].Name',
    'pg_stat_activity', "wait_event_type = 'Lock'",
    'pg_backend_pid()', 'pg_blocking_pids(pid)', 'server_node_blocked',
    'S4D3B2 real Worker lock evidence missing', 
    's.cmd.Process.Kill()', 'syscall.SIGKILL',
    'afterCrash.DeletedAt != nil || afterCrash.Revision != 1',
    'node.Revision != 2', '*node.TrashRootID != target.ID',
    'getTask(ownerToken, id)', 'getTask(foreignToken, id)',
    'count != 2', 'PWA_S4D3B2_BINARY_VERIFIED',
  ]) assert(source.includes(marker), 'missing real binary evidence: ' + marker)
  assert(source.indexOf('old := launch()') < source.indexOf('old.cmd.Process.Signal(syscall.SIGSTOP)') &&
    source.indexOf('old.cmd.Process.Signal(syscall.SIGSTOP)') < source.indexOf('firstID := enqueue(') &&
    source.indexOf('firstID := enqueue(') < source.indexOf('locker := scopedDB.Begin()') &&
    source.indexOf('locker := scopedDB.Begin()') < source.lastIndexOf('old.cmd.Process.Signal(syscall.SIGCONT)'),
    'real Server must be paused before product HTTP enqueue and resumed after the row lock')
  assert(source.includes("RETURNS trigger LANGUAGE plpgsql AS '"),
    'test-only PL/pgSQL function must have a valid single-quoted body')
  assert(source.includes('scopedDB.Exec(fmt.Sprintf('),
    'node identifier must be embedded as a trusted numeric SQL constant')
  assert(!source.includes('locker.Raw("SELECT id FROM xd_nodes WHERE id = ? FOR UPDATE"'),
    'locking the real Node blocks preflight before a mutation can start')
  assert(source.includes('lockHolderPID') && source.includes('observed.ServerNodeBlocked > 0'),
    'the test must prove a tagged Server backend blocked by the exact fixture-held lock')
  for (const bad of [
    'time.Sleep(80 * time.Second)', '/__test/pwa-s4d3/start-worker',
    'UPDATE xd_file_operations SET status', 'db.Model(&meta.FileOperation{}).Updates(',
    'skipWaiting', 'localStorage', 'CacheStorage',
  ]) assert(!source.includes(bad), 'prohibited test shortcut: ' + bad)
})

test('S4D3-B2 CI must compile real cmd/server, run isolated PG17 and exact HEAD', () => {
  for (const marker of [
    "github.head_ref == 'test/pwa-s4d3b2-real-server-binary-restart-20261015'",
    'postgres:17-alpine', 'go build -o', './cmd/server',
    'go test -c -o',
    'XD_PWA_S4D3B2_REAL_BINARY=1', 'XD_PWA_S4D3B2_BINARY_PATH',
    'TestPWAS4D3B2ActualServerRestartDuringDelete',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'gofmt -l',
  ]) assert(workflow.includes(marker), 'missing CI gate: ' + marker)
  assert(!workflow.includes('upload-artifact'), 'no server logs or private DB may be archived')
  assert(delivery.includes('PWA-S4D3-B2'), 'canonical delivery ledger must record this test')
})
