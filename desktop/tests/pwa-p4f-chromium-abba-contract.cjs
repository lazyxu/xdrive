'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {evaluate,percentile,readSummary}=require('../scripts/pwa-p4f-chromium-abba-summary.cjs')

test('P4F interpolated percentile validates finite nonnegative inputs',()=>{
 assert.equal(percentile([4,1,2,3],.5),2.5)
 assert.equal(percentile([7],.95),7)
 assert.throws(()=>percentile([],.5),/missing samples/)
 assert.throws(()=>percentile([1,NaN],.5),/invalid/)
 assert.throws(()=>percentile([1,-1],.5),/invalid/)
})

test('P4F refuses missing/fabricated native release evidence',()=>{
 assert.throws(()=>evaluate([]),/A-B-B-A/)
 assert.throws(()=>evaluate(['/absent','/absent','/absent','/absent']),
  /ENOENT|no such file/i)
 assert.throws(()=>readSummary('/absent'),/ENOENT|no such file/i)
})

test('P4F exact SHA, per-source browser and private cache gates are mandatory',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-p4f-negative-'))
 const old=process.env.XD_PR_HEAD
 try{
   process.env.XD_PR_HEAD='a'.repeat(40)
   fs.writeFileSync(path.join(dir,'summary.json'),
     JSON.stringify({accepted:true,nativeChromium:false,privatePersistentCache:true}))
   assert.throws(()=>readSummary(dir),/assert|false == true|expression evaluated/)
 }finally{
   if(old===undefined)delete process.env.XD_PR_HEAD
   else process.env.XD_PR_HEAD=old
   fs.rmSync(dir,{recursive:true,force:true})
 }
})
