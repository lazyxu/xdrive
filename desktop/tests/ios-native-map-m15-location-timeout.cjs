'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const read=x=>fs.readFileSync(path.resolve(__dirname,'../..',x),'utf8')
const location=read('ios/XDriveIOS/NativeMapUserLocationController.swift')

test('M15 explicit one-shot location request times out without stale callback',()=>{
  assert.match(location,/maximumLocationWait: TimeInterval = 15/)
  assert.match(location,/DispatchWorkItem \{ \[weak self, weak requestManager\]/)
  assert.match(location,/self\.manager === requestManager/)
  assert.match(location,/DispatchQueue\.main\.asyncAfter/)
  assert.match(location,/self\.fail\("定位超时/)
  assert.match(location,/func cancel\([\s\S]*?stopLocateTimeout\(\)/)
  assert.match(location,/private func fail\([\s\S]*?stopLocateTimeout\(\)/)
  assert.doesNotMatch(location,/requestAlwaysAuthorization\(|startUpdatingLocation\(/)
})
