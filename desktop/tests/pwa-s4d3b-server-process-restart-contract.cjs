'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('internal/api/pwa_s4d3b_process_restart_integration_test.go')
const workflow = read('.github/workflows/pwa-s4d3b-server-process-restart.yml')
const audit = read('docs/pwa-delivery.md')

test('S4D3B uses two real OS subprocesses and genuine persisted PostgreSQL worker states', () => {
  for (const token of [
    'fileExplorerMediaPerfDatabase(t, dsn)',
    'TestPWAS4D3BProcessChild',
    'srv.enqueueFileOperation(', 'srv.claimNextFileOperation(ctx)',
    'seed.Process.Kill()', 'syscall.SIGKILL',
    'srv.StartFileOperationWorker(bootCtx)',
    'meta.FileOperationStatusRunning', 'meta.FileOperationStatusQueued',
    'meta.FileOperationStatusCompleted', 'proof.ForeignID',
    'node.DeletedAt == nil', 'completed != 2',
    'seed.Process.Pid == restart.Process.Pid',
  ]) assert(source.includes(token), token)
  assert(!source.includes('db.Model(&meta.FileOperation{}).Updates('),
    'test must not update production operation status directly')
  assert(!source.includes('/__test/pwa-s4d3/start-worker'),
    'test must not depend on a synthetic HTTP Worker start')
})

test('S4D3B dedicated CI is opt-in, exact-head, and uses genuine PostgreSQL 17', () => {
  for (const token of [
    "github.head_ref == 'test/pwa-s4d3b-server-process-restart-20261015'",
    'postgres:17-alpine',
    'XD_PWA_S4D3B_REAL_RESTART=1',
    'TestPWAS4D3BServerRestartProcess',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'gofmt -l',
    'go test -c',
  ]) assert(workflow.includes(token), token)
  assert(!workflow.includes('upload-artifact'), 'private child data must not be archived')
  assert(audit.includes('PWA-S4D3-B1'))
})
