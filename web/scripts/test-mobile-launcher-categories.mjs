import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/mobileLauncherSections.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'category helper must transpile')
const model = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const keys = [
  'files', 'gallery', 'device-backup', 'remote-pull', 'transfers',
  'cloud-storage', 'local-storage', 'custom-feature',
]
const input = keys.map(key => ({ key, label: key }))
const groups = model.xDriveMobileLauncherSections(input)
assert.deepEqual(groups.map(group => group.key), ['photos', 'files', 'backup', 'tasks', 'other'])
assert.deepEqual(groups.map(group => group.label), [
  '图库与相册', '文件与存储', '备份与同步', '任务与传输', '其他功能',
])
assert.deepEqual(groups.flatMap(group => group.items.map(item => item.key)), [
  'gallery', 'files', 'cloud-storage', 'local-storage', 'device-backup',
  'remote-pull', 'transfers', 'custom-feature',
])
assert.deepEqual(input.map(item => item.key), keys, 'must not mutate authenticated destinations')
assert.equal(groups.some(group => group.key === 'admin'), false,
  'non-admin destination input may never grow new privileged destinations')
const admin = model.xDriveMobileLauncherSections([
  ...input, { key: 'admin-users', label: '用户管理' },
  { key: 'admin-services', label: '系统依赖' },
])
assert.deepEqual(admin.find(group => group.key === 'admin')?.items.map(item => item.key),
  ['admin-users', 'admin-services'])
assert.deepEqual(model.xDriveMobileLauncherSections([]), [])
const duplicate = model.xDriveMobileLauncherSections([
  { key: 'files', label: 'old' }, { key: 'files', label: 'new' },
])
assert.deepEqual(duplicate.flatMap(group => group.items).map(item => item.label), ['new'])
const app = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
const launcher = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
assert.match(app, /xDriveMobileLauncherSections\(mobileDestinations\)/,
  'categories must start from server-authorized Web navigation only')
assert.match(launcher, /sections\.map\(section => showGroup\(String\(section\.label/,
  'Launcher must actually render category headings instead of one flat grid')
assert.match(launcher, /showGroup\('收藏', favoritesItems\)/, 'retain Owner favorites above categories')
assert.match(launcher, /onClick=\{\(\) => onToggleFavorite\(item\.key\)\}/,
  'favorite actions remain controlled by the Owner-scoped parent')
assert.match(launcher, /width: 44, height: 44/,
  'favorite touch hit targets must be at least 44 by 44 CSS pixels')
assert.doesNotMatch(launcher, /setFavorites\(/,
  'category switching must not restore remount-local favorite state')
console.log('Mobile Launcher categories: authorized destinations, role, search and 44px favorite control passed')
