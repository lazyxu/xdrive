const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

test('Source Manager connector labels do not duplicate direction or mix Source naming', () => {
  const manager = read('ui/shared/src/mui/SourceManager.tsx')
  for (const filename of [
    'ui/shared/src/mui/SourceManager.tsx',
    'ui/shared/src/mui/SourceManagerListPage.tsx',
     'ui/shared/src/mui/SourceManagerSettingsDialog.tsx',
    'ui/shared/src/mui/SourceManagerDetailsDialog.tsx',
    'ui/shared/src/mui/SourceManagerDialogs.tsx',
    'ui/shared/src/mui/SourceBasicFields.tsx',
  ]) {
    const source = read(filename)
    assert.doesNotMatch(source, /同步文件夹|Pull worker|Pull 模式|· Pull/, filename)
  }
  const createDialog = read('ui/shared/src/mui/SourceManagerCreateDialog.tsx')
  assert.match(createDialog, /同步文件夹 \/ Push/)
  assert.match(createDialog, /同步文件夹 \/ Pull/)
  assert.match(createDialog, /只允许修改最后一级目录名称/)
  const viewModel = read('ui/shared/src/external-sources.ts')
  assert.match(viewModel, /source\.direction === 'pull' \? mode :/)
  assert.doesNotMatch(viewModel, /label: '[^']+ · Pull'/)
  assert.doesNotMatch(viewModel, /label: '群晖 Photos · Push'/)
  assert.match(viewModel, /label: '群晖 Photos Push（已停用）'/)
  assert.match(viewModel, /const match = path\.match/)
  assert.match(read('ui/shared/src/mui/SourceManagerListPage.tsx'), /directionFilter === 'pull' \? '拉取来源' : '来源'/)
  assert.match(read('ui/shared/src/mui/SourceManagerListPage.tsx'), /sourceName === card.connector.label \? card.modeLabel/)
  assert.match(manager, /nameToPersist = normalizedName === externalSourceDisplayName\(setting.source\)/)
  assert.match(createDialog, /同步文件夹 \/ Pull/)
  assert.match(read('ui/shared/src/mui/SourceManagerSettingsDialog.tsx'), /externalSourceDisplayTargetPath\(setting\.source\)/)
  assert.match(read('ui/shared/src/mui/SourceManagerSettingsDialog.tsx'), /externalSourceDisplayTargetPath\(setting\.source\)/)
  assert.match(read('ui/shared/src/mui/SourceManagerDetailsDialog.tsx'), /externalSourceDisplayTargetPath\(row\.source\)/)
})

test('Web, Mobile Web and Desktop expose one unified Push/Pull Source Manager', () => {
  const manager = read('ui/shared/src/mui/SourceManager.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const browserHost = read('web/src/browserWorkspaceHost.ts')
  assert.match(web, /remotePull: \{/)
  assert.match(web, /adapter: sourceManagerAdapter/)
  assert.match(browserHost, /remotePullPage: \{ \.\.\.ports\.remotePull \}/)
  assert.match(desktop, /remotePullPage:/)
  assert.doesNotMatch(browserHost, /directionFilter:\s*'pull'/)
  assert.doesNotMatch(desktop, /remotePullPage:\s*agent\.hello\?\.capabilities/)
  assert.match(read('ui/shared/src/mui/WorkspaceRouteTitles.ts'), /'remote-pull': '来源管理'/)
  assert.doesNotMatch(desktop, /directionFilter:\s*"pull"/)
  assert.match(read('ui/shared/src/mui/XDriveAppPageOutlet.tsx'), /<XDriveSourceManager \{\.\.\.services\.remotePullPage\} \/>/)
  assert.match(manager, /directionFilter !== 'pull' \|\| item\.source\.direction === 'pull'/)
  assert.match(manager, /direction: option\.direction/)
  assert.match(manager, /adapter\.sourceOverview\(\)/)
  assert.match(manager, /adapter\.createSource\(/)
  assert.match(manager, /adapter\.deleteSource\(/)
  assert.doesNotMatch(web, /该同步文件夹不存在|正在根据原同步文件夹 ID 确认 Push\/Pull/)
  const agents = read('docs/history/AGENTS-2026-10-27-before-consolidation.md')
  assert.match(agents, /远程拉取.*拉取来源/)
})
