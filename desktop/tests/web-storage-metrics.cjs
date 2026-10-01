const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const storageStats = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')
const metricCards = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'MetricCards.tsx'), 'utf8')
const sectionHeader = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SectionHeader.tsx'), 'utf8')
const desktopApp = [
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopDiagnosticsPage.tsx'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopStoragePage.tsx'), 'utf8'),
].join('\n')
const desktopStyles = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')

test('Web storage statistics use shared metric primitives', () => {
  assert.equal((storageStats.match(/<XDriveMetricGrid\b/g) || []).length, 4)
  assert.equal((storageStats.match(/<XDriveMetricCard\b/g) || []).length, 27)
  assert.equal((storageStats.match(/<XDriveSectionHeader\b/g) || []).length, 6)
  assert.equal(storageStats.includes('function StorageStatGrid'), false)
  assert.equal(storageStats.includes('function StorageStat('), false)
  assert.equal(storageStats.includes('function SectionTitle'), false)
  assert.ok(metricCards.includes("gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }"))
  assert.equal(metricCards.includes('XDriveSectionHeading'), false)
  assert.ok(sectionHeader.includes('component={level}'))
  assert.ok(sectionHeader.includes("level === 'h3'"))
})


test('Desktop storage, diagnostics and update statistics reuse shared metric primitives', () => {
  assert.equal((desktopApp.match(/<XDriveMetricGrid\b/g) || []).length, 5)
  assert.equal((desktopApp.match(/<XDriveMetricCard\b/g) || []).length, 29)
  assert.equal(desktopApp.includes('className="cloud-quota-grid"'), false)
  assert.equal(desktopApp.includes('className="cache-metrics"'), false)
  assert.equal(desktopApp.includes('className="update-metrics"'), false)
  assert.equal(desktopStyles.includes('.cloud-quota-grid'), false)
  assert.equal(desktopStyles.includes('.cache-metrics'), false)
  assert.equal(desktopStyles.includes('.update-metrics'), false)
  assert.equal(desktopApp.includes('className="diagnostic-summary"'), false)
  assert.equal(desktopStyles.includes('.diagnostic-summary'), false)
  assert.equal(desktopStyles.includes('.diagnostic-count'), false)
  assert.equal(desktopStyles.includes('.diagnostic-generated'), false)
  assert.ok(desktopApp.includes('tone="good"'))
  assert.ok(desktopApp.includes('tone="warning"'))
  assert.ok(desktopApp.includes('tone="bad"'))
  assert.ok(metricCards.includes('tone?: XDriveStatusTone'))
  assert.ok(metricCards.includes('metricValueColor(tone)'))
})
