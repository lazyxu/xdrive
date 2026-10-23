'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const source=read('scripts/pwa-cr03f-kernel-eio-capability.sh')
const workflow=read('.github/workflows/pwa-cr03f-kernel-eio-capability.yml')
test('CR03f only a newly allocated fixed private loopback device can be faulted',()=>{
 for(const phrase of ['GITHUB_ACTIONS','XD_PWA_CR03F_CAPABILITY','RUNNER_TEMP',
  'truncate -s 64M','sudo losetup --find --show','sudo blockdev --getsz',
  'dmsetup create "$DM"','dmsetup reload "$DM" --table "0 $SECTORS error"',
  'iflag=direct','Input/output error','mappingRestored','kernelDirectReadAfter'])
  assert(source.includes(phrase),phrase)
 assert(!/\/dev\/sd[a-z]|\/dev\/nvme[0-9]|\/mnt\/production/.test(source))
 assert(source.includes('trap cleanup EXIT'))
 assert(source.includes('rm -rf -- "$ROOT"'))
})
test('CR03f proves capability only; neither IDB nor private Owner is claimed',()=>{
 assert(source.includes('"chromiumIndexedDBTested":false'))
 assert(source.includes('"physicalIOS":false'))
 assert(source.includes('"productionModified":false'))
 assert(!source.includes('new DOMException'))
 assert(!source.includes('Storage.overrideQuotaForOrigin'))
})
test('CR03f exact-head opt-in Linux gate fails closed on unavailable real device mapper',()=>{
 for(const key of ['github.event.pull_request.head.sha','node-version:',
  'node --test desktop/tests/pwa-cr03f-kernel-eio-capability-contract.cjs',
  'bash -n scripts/pwa-cr03f-kernel-eio-capability.sh',
  'bash scripts/pwa-cr03f-kernel-eio-capability.sh',
  'dmsetup util-linux','actions/upload-artifact@v4',
  'github.head_ref'])
  assert(workflow.includes(key),key)
 // losetup and dmsetup are invoked only inside the gated fixed-name Bash
 // script; workflow installs util-linux (provides losetup), not a command named
 // "losetup" in the YAML. Validate each at the source of the invocation.
 for(const token of ['sudo losetup --find --show', 'sudo losetup -d "$LOOP"',
   'sudo timeout 10s dmsetup create', 'sudo timeout 10s dmsetup reload'])
  assert(source.includes(token),token)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('workflow_dispatch:'))
})
