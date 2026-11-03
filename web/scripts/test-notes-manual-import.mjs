import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../../ui/shared/src/notes-manual-import.ts'), 'utf8')
const result = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.deepEqual(result.diagnostics ?? [], [])
const {
  xDriveNotesSelectManualExport: select,
  xDriveNotesPlanManualExport: plan,
} = await import('data:text/javascript;base64,' +
  Buffer.from(result.outputText).toString('base64'))

const file = (name, size = 500, relative = '') => ({
  name, size, type: name.endsWith('.png') ? 'image/png' : 'text/markdown',
  webkitRelativePath: relative,
})
const md = file('旅行.md', 150, 'Export/notes/旅行.md')
const image = file('photo 1.png', 1500, 'Export/notes/Media/photo 1.png')
const other = file('photo 2.jpg', 2500, 'Export/notes/Media/photo 2.jpg')
const chosen = select([md, image, other])
assert.equal(chosen.markdownFile, md)
assert.equal(chosen.assets.length, 2)

const body = '# 旅行\n![海边](Media/photo%201.png)\n![远景](<Media/photo 2.jpg>)'
const parsed = plan(body, md, [image, other])
assert.deepEqual(parsed.references.map(x => x.asset.name), ['photo 1.png', 'photo 2.jpg'])
const id = '11111111-1111-4111-8111-111111111111'
const a = '_assets/' + id + '/22222222-2222-4222-8222-222222222222.png'
const b = '_assets/' + id + '/33333333-3333-4333-8333-333333333333.jpg'
const rewritten = parsed.rewrite(new Map([
  ['Media/photo%201.png', a],
  ['<Media/photo 2.jpg>', b],
]))
assert.equal(rewritten, '# 旅行\n![海边](' + a + ')\n![远景](' + b + ')')
assert.throws(() => parsed.rewrite(new Map()), /图片未上传成功/)
assert.throws(() => parsed.rewrite(new Map([
  ['Media/photo%201.png', 'https://evil.example/photo.png'],
  ['<Media/photo 2.jpg>', b],
])), /相对路径无效/)

const duplicate = file('photo.png', 1000, 'Export/different/photo.png')
const duplicate2 = file('photo.png', 1000, 'Export/another/photo.png')
assert.throws(() => plan('![x](photo.png)', md, [duplicate, duplicate2]), /同名图片/)
assert.throws(() => plan('![x](not-found.png)', md, [image]), /缺少/)
const standalone = plan('![x](photo.png)', file('hello.md'), [file('photo.png')])
assert.equal(standalone.references.length, 1)
const shared = file('photo.png', 1000, 'Export/assets/photo.png')
assert.equal(plan('![x](../assets/photo.png)', md, [shared]).references[0].asset, shared)
for (const bad of [
  '![x](../../../../etc/passwd.png)',
  '![x](https://example.com/a.png)',
  '![x](data:image/png;base64,AAA)',
  '![x](//example.com/a.png)',
  '![x](/absolute.png)',
  '![x](%2Foutside.png)',
  '![x](Media/photo%5csecret.png)',
  '![x](Media/photo.png?token=sensitive)',
]) assert.throws(() => plan(bad, md, [image]), bad)

const fence = String.fromCharCode(96).repeat(3)
const fenced = plan(['# Note', fence + 'md', '![code](missing.png)', fence,
  '![real](Media/photo%201.png)'].join('\n'), md, [image])
assert.equal(fenced.references.length, 1)
assert.match(fenced.rewrite(new Map([['Media/photo%201.png', a]])),
  /!\[code\]\(missing.png\)/)

assert.throws(() => select([]), /请选择/)
assert.throws(() => select([md, file('other.md')]), /每次只能导入一条/)
assert.throws(() => select([file('huge.md', 1_048_577)]), /1 MiB/)
assert.throws(() => select([md, file('huge.png', 20_000_001)]), /20 MiB/)
assert.throws(() => plan('Hello', file('bad\nname.md'), []), /标题/)
console.log('Manual Notes Markdown/image bundles, folder paths and upload fencing: PASS')
