'use strict'
const {spawnSync}=require('node:child_process')
const path=require('node:path')
const electron=require('electron')
const env={...process.env}
delete env.ELECTRON_RUN_AS_NODE
const target=path.join(__dirname,'places-electron-lan-guest-main.cjs')
const result=spawnSync(electron,['--no-sandbox','--disable-gpu',target],{
  env,stdio:'inherit',timeout:120000,
})
if(result.error)throw result.error
if(result.status!==0)throw Error('real Electron LAN Guest failed with '+String(result.status)+
  (result.signal?' signal '+result.signal:''))
