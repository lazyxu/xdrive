const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const sharedIcon = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceKindIcon.tsx'), 'utf8')
const sharedSources = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const sourceSummaryCard = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceSummaryCard.tsx'), 'utf8')

test('source kind icons distinguish Photos, File Station and Yike', () => {
  assert.match(sharedIcon, /synology_photos.*PhotoLibraryRoundedIcon/)
  assert.match(sharedIcon, /synology_files.*FolderCopyRoundedIcon/)
  assert.match(sharedIcon, /yike_photos.*CloudRoundedIcon/)
  assert.match(sharedSources, /kind === 'synology_files'/)
  assert.match(sharedSources, /label: '群晖 File Station'/)
})

test('Web and Desktop source cards consume the shared source kind icon', () => {
  assert.ok(sourceSummaryCard.includes('icon?: ReactNode'), 'shared source summary card must expose an icon slot')
  assert.ok(sourceSummaryCard.includes('{icon}'), 'shared source summary card must render its icon slot')
  assert.match(web, /<XDriveSourceKindIcon kind=\{row\.source\.kind\}/)
  assert.match(web, /<XDriveSourceKindIcon kind=\{item\.kind\} size="small"/)
  assert.match(desktop, /<XDriveSourceKindIcon kind=\{row\.source\.kind\}/)
  assert.ok(web.includes('modeLabel={`${card.connector.label} · ${card.modeLabel}`}'), 'Web summary card should include connector and mode labels')
  assert.ok(desktop.includes('modeLabel={`${card.connector.label} · ${card.modeLabel}`}'), 'Desktop summary card should include connector and mode labels')
})
