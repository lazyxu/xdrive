const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const storageStats = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')
const metricCards = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'MetricCards.tsx'), 'utf8')

test('Web storage statistics use shared metric primitives', () => {
  assert.equal((storageStats.match(/<XDriveMetricGrid\b/g) || []).length, 4)
  assert.equal((storageStats.match(/<XDriveMetricCard\b/g) || []).length, 27)
  assert.equal((storageStats.match(/<XDriveSectionHeading\b/g) || []).length, 6)
  assert.equal(storageStats.includes('function StorageStatGrid'), false)
  assert.equal(storageStats.includes('function StorageStat('), false)
  assert.equal(storageStats.includes('function SectionTitle'), false)
  assert.ok(metricCards.includes("gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }"))
  assert.ok(metricCards.includes('component="h3"'))
})
