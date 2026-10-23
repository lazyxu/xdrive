#!/usr/bin/env node
'use strict'
// P1E: isolated CI worktree diagnostic only. NEVER patches the checked-out PR
// or production branch; variant is not a published product fix.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {spawnSync}=require('node:child_process'),crypto=require('node:crypto')
assert.equal(process.env.XD_PWA_P1E_TEST_VARIANT,'1')
assert.equal(process.env.GITHUB_ACTIONS,'true')
const root=process.env.GITHUB_WORKSPACE, output=process.env.XD_PWA_P1E_FINGERPRINT
assert(root&&path.isAbsolute(root)&&output&&path.isAbsolute(output))
const base=path.join(root,'without-transition')
const target=path.join(base,'web/src/webAppRuntime.ts')
const b=fs.realpathSync(base),f=fs.realpathSync(target)
assert.equal(b,path.resolve(base))
assert.equal(f,path.resolve(target))
assert(f.startsWith(b+path.sep))
const REF='7515c421412666893e4b0519e4b5869d988bf8e1'
const EXPECTED_GIT_BLOB='7a3131ed7a2b44a7fbe407ee4a79079a3bb54749'
const command=(args)=>{const p=spawnSync('git',args,{cwd:base,encoding:'utf8'})
 assert.equal(p.status,0,'private frozen git source verification failed')
 return p.stdout.trim()}
assert.equal(command(['rev-parse','HEAD']),REF)
assert.equal(command(['hash-object','web/src/webAppRuntime.ts']),EXPECTED_GIT_BLOB)
assert.equal(command(['status','--porcelain']),'' )
const input=fs.readFileSync(f,'utf8')
const targetCall='startTransition(() => setRoute(next))'
const originalImport="import { startTransition, useCallback, useEffect, useRef, useState } from 'react'"
const replacementImport="import { useCallback, useEffect, useRef, useState } from 'react'"
assert.equal(input.split(targetCall).length-1,2)
assert.equal(input.split(originalImport).length-1,1)
const updated=input.replace(originalImport,replacementImport).replaceAll(targetCall,'setRoute(next)')
assert(!updated.includes('startTransition'))
assert.equal(updated.split('setRoute(next)').length-1,2)
fs.writeFileSync(f,updated)
assert.equal(command(['diff','--name-only']),'web/src/webAppRuntime.ts')
const fingerprint={schema:'xdrive-pwa-p1e-route-transition-variant-v1',
 sourceRelease:REF,sourceGitBlob:EXPECTED_GIT_BLOB,
 scope:'test-only-two-transition-calls',originalCallCount:2,
 originalSHA256:crypto.createHash('sha256').update(input).digest('hex'),
 variantSHA256:crypto.createHash('sha256').update(updated).digest('hex'),
 productionSourceModified:false,physicalIOS:false,full100kStartupMeasured:false}
fs.mkdirSync(path.dirname(output),{recursive:true})
fs.writeFileSync(output,JSON.stringify(fingerprint,null,2)+'\n',{mode:0o600})
console.log('PWA_P1E_TEST_ONLY_VARIANT_VERIFIED '+JSON.stringify({
 sourceRelease:REF,originalCalls:2,originalSHA256:fingerprint.originalSHA256,
 variantSHA256:fingerprint.variantSHA256}))
