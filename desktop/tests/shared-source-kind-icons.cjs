const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const sharedIcon = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceKindIcon.tsx'), 'utf8')
const sharedSources = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const sourceManager = [
  'SourceManager.tsx',
  'SourceManagerListPage.tsx',
].map((name) => fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', name), 'utf8')).join('\n')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'App.tsx'), 'utf8') + sourceManager
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + sourceManager
const sourceSummaryCard = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceSummaryCard.tsx'), 'utf8')
const sourceBasicFields = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceBasicFields.tsx'), 'utf8')

test('source kind icons use vendored service artwork', () => {
  for (const filename of ['synology-photos.png', 'synology-file-station.png', 'yike-photos.png']) {
    assert.ok(sharedIcon.includes(filename), `missing source icon reference: ${filename}`)
    assert.equal(
      fs.existsSync(path.join(repo, 'ui', 'shared', 'assets', 'source-icons', filename)),
      true,
      `missing source icon asset: ${filename}`,
    )
  }
  for (const semanticIcon of ['PhotoLibraryRoundedIcon', 'FolderCopyRoundedIcon', 'CloudRoundedIcon']) {
    assert.equal(sharedIcon.includes(semanticIcon), false, `known brand should not use semantic icon: ${semanticIcon}`)
  }
  assert.match(sharedSources, /kind === 'synology_files'/)
  assert.match(sharedSources, /label: '群晖 File Station'/)
})

test('Web and Desktop source cards and preset field consume the shared branded icon', () => {
  assert.ok(sourceSummaryCard.includes('icon?: ReactNode'), 'shared source summary card must expose an icon slot')
  assert.ok(sourceSummaryCard.includes('{icon}'), 'shared source summary card must render its icon slot')
  assert.match(web, /icon=\{<XDriveSourceKindIcon kind=\{row\.source\.kind\}/)
  assert.match(desktop, /icon=\{<XDriveSourceKindIcon kind=\{row\.source\.kind\}/)
  assert.match(sourceBasicFields, /<XDriveSourceKindIcon kind=\{option\.kind\} size="small"/)
  assert.ok(sourceBasicFields.includes('externalSourceCreateOptions.filter'), 'shared preset field must render the shared Source options through capability filtering')
  assert.ok(sourceBasicFields.includes("option.kind !== 'local_folder'"), 'local folder option must be hidden when native Agent authorization is unavailable')
  assert.ok(sourceBasicFields.includes('allowLocalPush'), 'native capability must explicitly enable the local folder option')
})
