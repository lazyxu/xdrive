const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8')

test('remote Pull UI labels have no redundant direction or mixed Source naming', () => {
  const manager = read('ui/shared/src/mui/SourceManager.tsx')
  for (const filename of [
    'ui/shared/src/mui/SourceManager.tsx',
    'ui/shared/src/mui/SourceManagerListPage.tsx',
    'ui/shared/src/mui/SourceManagerCreateDialog.tsx',
    'ui/shared/src/mui/SourceManagerSettingsDialog.tsx',
    'ui/shared/src/mui/SourceManagerDetailsDialog.tsx',
    'ui/shared/src/mui/SourceManagerDialogs.tsx',
    'ui/shared/src/mui/SourceBasicFields.tsx',
  ]) {
    const source = read(filename)
    assert.doesNotMatch(source, /同步文件夹|Pull worker|Pull 模式|· Pull/, filename)
  }
  const viewModel = read('ui/shared/src/external-sources.ts')
  assert.match(viewModel, /source\.direction === 'pull' \? mode :/)
  assert.doesNotMatch(viewModel, /label: '[^']+ · Pull'/)
  assert.match(viewModel, /label: '群晖 Photos · Push'/)
  assert.match(viewModel, /const match = path\.match/)
  assert.match(read('ui/shared/src/mui/SourceManagerListPage.tsx'), /directionFilter === 'pull' \? '拉取来源' : '来源'/)
  assert.match(read('ui/shared/src/mui/SourceManagerListPage.tsx'), /sourceName === card.connector.label \? card.modeLabel/)
  assert.match(manager, /nameToPersist = normalizedName === externalSourceDisplayName\(setting.source\)/)
  assert.match(read('ui/shared/src/mui/SourceManagerCreateDialog.tsx'), /yikeManagedTargetDisplayLabel/)
  assert.match(read('ui/shared/src/mui/SourceManagerSettingsDialog.tsx'), /externalSourceDisplayTargetPath\(setting\.source\)/)
  assert.match(read('ui/shared/src/mui/SourceManagerDetailsDialog.tsx'), /externalSourceDisplayTargetPath\(row\.source\)/)
})

test('Web, Mobile Web and Desktop use the same Pull-only surface and preserve transport direction', () => {
  const manager = read('ui/shared/src/mui/SourceManager.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  for (const page of [web, desktop]) {
    assert.match(page, /<XDriveSourceManager/)
    assert.match(page, /directionFilter="pull"/)
  }
  assert.match(manager, /directionFilter !== 'pull' \|\| item\.source\.direction === 'pull'/)
  assert.match(manager, /direction: option\.direction/)
  assert.match(manager, /adapter\.sourceOverview\(\)/)
  assert.match(manager, /adapter\.createSource\(/)
  assert.match(manager, /adapter\.deleteSource\(/)
  assert.doesNotMatch(web, /该同步文件夹不存在|正在根据原同步文件夹 ID 确认 Push\/Pull/)
  const agents = read('AGENTS.md')
  assert.match(agents, /远程拉取.*拉取来源/)
})
