'use strict'
const {spawnSync}=require('node:child_process')
const path=require('node:path')
const electron=require('electron')
const env={...process.env}
delete env.ELECTRON_RUN_AS_NODE
const main=path.join(__dirname,'places-electron-selected-connection-ip-main.cjs')
const run=spawnSync(electron,['--no-sandbox','--disable-gpu',main],{
  env,stdio:'inherit',timeout:110000,
})
if(run.error)throw run.error
if(run.status!==0)throw Error('real Electron selected-IP route failed: '+
  String(run.status)+(run.signal?' signal '+run.signal:''))
