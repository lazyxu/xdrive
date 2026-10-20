'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const device=read('ui/shared/src/mui/DeviceBackupPage.tsx')
const home=read('ui/shared/src/mui/HomePage.tsx')
const popup=read('ui/shared/src/mui/TransferPopover.tsx')
const ast=ts.createSourceFile('DeviceBackupPage.tsx',device,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX)
function attr(el,marker){return el?.attributes?.properties?.find(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)===marker)??null}
function find(marker){
  const out=[]
  function visit(n){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&attr(n,marker))out.push(n);ts.forEachChild(n,visit)}
  visit(ast);assert.equal(out.length,1,'exactly one original JSX owner '+marker);return out[0]
}
function inside(n,marker){for(let p=n.parent;p;p=p.parent)if(ts.isJsxElement(p)&&attr(p.openingElement,marker))return true;return false}
test('P119: Device Backup async receipts never enter the accepted card layout',()=>{
  const feedback=find('data-xdrive-device-backup-feedback-overlay')
  const overview=find('data-xdrive-device-backup-overview')
  assert.equal(inside(feedback,'data-xdrive-device-backup-overview'),false)
  for(const marker of ['data-xdrive-device-backup-local-feedback',
    'data-xdrive-device-backup-refresh-error',
    'data-xdrive-device-backup-more-page-error']){
    assert.ok(inside(find(marker),'data-xdrive-device-backup-feedback-overlay'))
    assert.equal(inside(find(marker),'data-xdrive-device-backup-overview'),false)
  }
  assert.match(feedback.parent.getText(ast).slice(0,900),/position: 'fixed'/)
  assert.match(feedback.parent.getText(ast).slice(0,900),/safe-area-inset-bottom/)
  assert.match(feedback.parent.getText(ast).slice(0,1100),/pointerEvents: 'none'/)
  assert.ok(overview.parent.getText(ast).includes('data-xdrive-device-backup-first-read'))
  assert.ok(device.includes('loading && !overview ? ('))
  assert.ok(device.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(device.includes('overview && showReadProgress'))
})
test('P119: each folder/history failure stays in an already-mounted scoped owner',()=>{
  const paged=find('data-xdrive-device-backup-folder-page-status')
  const folderError=find('data-xdrive-device-backup-folder-error')
  const history=find('data-xdrive-device-backup-history-list')
  const historyError=find('data-xdrive-device-backup-history-error')
  assert.ok(inside(folderError,'data-xdrive-device-backup-folder-page-status'))
  assert.ok(inside(historyError,'data-xdrive-device-backup-history-list'))
  assert.match(paged.parent.getText(ast).slice(0,390),/position: 'relative'/)
  assert.match(history.parent.getText(ast).slice(0,360),/position: 'relative'/)
  assert.match(folderError.parent.getText(ast).slice(0,650),/position: 'absolute'/)
  assert.match(historyError.parent.getText(ast).slice(0,650),/position: 'absolute'/)
  assert.ok(device.includes('无法加载历史，请重试'))
  assert.ok(device.includes('文件夹读取失败，已保留当前内容；可重试'))
  assert.ok(device.includes('source.foldersPage(deviceID, 100, cursor)'))
})
test('P119: Transfer history first read is silent while real empty/results remain truthful',()=>{
  assert.equal(popup.includes('正在加载传输记录…'),false)
  for(const token of ['data-xdrive-transfer-popover-first-read','data-xdrive-transfer-popover-verified-empty',
    'aria-busy="true"','minHeight: 64','暂无进行中的上传或下载。','暂无上传或下载历史。',
    'XDriveTransferTreeItem','onRetry','onCancel'])assert.ok(popup.includes(token),token)
  assert.ok(home.includes('data-xdrive-home-floating-alerts'))
  assert.ok(home.includes('XDriveFileExplorerThumbnailProvider'))
  const agents=read('AGENTS.md')
  assert.equal(agents.split('## P119 · Home Device Backup and Transfer Popover async receipts cannot reflow').length,2)
})
