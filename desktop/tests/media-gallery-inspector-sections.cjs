const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

function loadTypeScript(filename, bindings = {}) {
  const source = read(...filename.split('/'))
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(bindings, request)) return bindings[request]
    // This test calls the pure field builder, not the JSX surface or React hooks.
    if (request === 'react' || request === 'react/jsx-runtime' ||
        request === '@mui/material' || request === '@mui/icons-material') return {}
    return {}
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const timezone = loadTypeScript('ui/shared/src/media-timezone.ts')
const capture = loadTypeScript('ui/shared/src/media-viewer.ts', {
  './media-timezone': timezone,
})
const utils = loadTypeScript('ui/shared/src/mui/MediaGalleryUtils.ts')
const { xDriveMediaInspectorFields } = loadTypeScript(
  'ui/shared/src/mui/MediaGalleryDetails.tsx',
  {
    '../media-viewer': capture,
    '../format': { formatBytes: (value) => `${value} B` },
    './MediaGalleryUtils': utils,
  },
)

function fixture(mediaKind = 'image') {
  return {
    node: {
      id: 73,
      name: 'sample.HEIC',
      parent_id: 5,
      type: 'file',
      size: 4096,
      revision: 1,
      created_at: '2026-10-09T00:00:00Z',
      updated_at: '2026-10-09T00:00:00Z',
    },
    metadata: {
      media_kind: mediaKind,
      mime_type: mediaKind === 'video' ? 'video/quicktime' : 'image/heic',
      index_state: 'ready',
      has_thumbnail: true,
      width: 4032,
      height: 3024,
      captured_at: '2026-10-08T00:00:00Z',
      camera_make: 'Apple',
      camera_model: 'iPhone 15 Pro',
      lens_model: 'Wide Camera',
      latitude: 0,
      longitude: 103.812,
      thumbnail_width: 384,
      thumbnail_height: 288,
      thumbnail_mime_type: 'image/jpeg',
    },
    favorite: true,
    tags: ['旅行', '亲友'],
    people: ['小明'],
    description: '海边',
    resources: [
      { kind: 'node', node_id: 73, role: 'still', name: 'sample.HEIC', size: 4096 },
      { kind: 'node', node_id: 74, role: 'motion', name: 'sample.MOV', size: 8192 },
    ],
  }
}

const labels = (rows) => rows.map(([label]) => label)
const field = (rows, label) => rows.find(([name]) => name === label)?.[1]

test('Inspector puts technical capture data first and file metadata in its own section', () => {
  const result = xDriveMediaInspectorFields(fixture())
  assert.deepEqual(labels(result.photoInfo).slice(0, 4), ['类型', '拍摄时间', '分辨率', '方向'])
  assert.equal(field(result.photoInfo, '分辨率'), '4032 × 3024')
  assert.equal(field(result.photoInfo, '相机'), 'Apple iPhone 15 Pro')
  assert.equal(field(result.photoInfo, '镜头'), 'Wide Camera')
  assert.equal(field(result.photoInfo, 'GPS'), '0.000000, 103.812000')
  assert.equal(labels(result.photoInfo).includes('文件名'), false)

  assert.deepEqual(labels(result.organize), ['收藏', '标签', '人物', '备注'])
  assert.equal(field(result.organize, '标签'), '旅行、亲友')
  assert.equal(field(result.organize, '备注'), '海边')
  assert.deepEqual(labels(result.files), ['文件名', '大小', '格式', '缩略图', '资源数'])
  assert.equal(field(result.files, '文件名'), 'sample.HEIC')
  assert.equal(field(result.files, '大小'), '4096 B')
  assert.equal(field(result.files, '资源数'), '2')
})

test('Inspector matches Viewer canonical capture time and never substitutes file modification time', () => {
  const missing = fixture()
  delete missing.metadata.captured_at
  const invalid = fixture()
  invalid.metadata.captured_at = 'not-a-date'
  assert.equal(field(xDriveMediaInspectorFields(missing).photoInfo, '拍摄时间'), '未记录')
  assert.equal(field(xDriveMediaInspectorFields(invalid).photoInfo, '拍摄时间'), '未记录')
  assert.equal(capture.xDriveMediaCaptureTimeLabel('not-a-date'), '拍摄时间：未记录')
  const valid = fixture()
  assert.equal(
    capture.xDriveMediaCaptureTimeLabel(valid.metadata.captured_at),
    `拍摄时间：${field(xDriveMediaInspectorFields(valid).photoInfo, '拍摄时间')}`,
  )
})

test('Inspector preserves video fields and multi-resource details without guessing a path', () => {
  const video = fixture('video')
  video.metadata.duration_ms = 4829
  video.metadata.frame_rate = 59.94
  video.metadata.bit_rate = 12000000
  video.metadata.video_codec = 'hevc'
  video.metadata.audio_codec = 'aac'
  const result = xDriveMediaInspectorFields(video)
  assert.equal(field(result.photoInfo, '时长'), '0:05')
  assert.equal(field(result.photoInfo, '帧率'), '59.94 fps')
  assert.equal(field(result.photoInfo, '码率'), '12.00 Mbps')
  assert.equal(field(result.photoInfo, '视频编码'), 'hevc')
  assert.equal(field(result.photoInfo, '音频编码'), 'aac')
  assert.equal(result.files.some(([label]) => label === '路径' || label === '同步文件夹'), false)
  const standalone = fixture()
  standalone.resources = [standalone.resources[0]]
  standalone.metadata.thumbnail_width = undefined
  assert.equal(field(xDriveMediaInspectorFields(standalone).files, '资源数'), undefined)
  assert.equal(field(xDriveMediaInspectorFields(standalone).files, '缩略图'), undefined)
})

test('Web/Desktop consume one shared Inspector section order and retain read-only metadata', () => {
  const details = read('ui', 'shared', 'src', 'mui', 'MediaGalleryDetails.tsx')
  const inspector = read('ui', 'shared', 'src', 'mui', 'MediaGalleryInspector.tsx')
  const selectors = [
    'data-xdrive-media-details-info',
    'data-xdrive-media-details-organize',
    'data-xdrive-media-details-file-resources',
  ]
  const offsets = selectors.map((selector) => details.indexOf(selector))
  assert.ok(offsets.every((value) => value >= 0), 'all three Inspector sections must exist')
  assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2], 'photo information should come before editing and files')
  for (const action of ['!onSetFavorite', '!onSetTags', '!onSetPeople', '!onSetDescription']) {
    assert.ok(details.includes(action), `read-only Inspector metadata missing: ${action}`)
  }
  for (const action of ['保存标签', '保存人物', '保存描述', '从当前相册移除', '资产资源']) {
    assert.ok(details.includes(action), `legacy editing/resource action missing: ${action}`)
  }
  assert.match(inspector, /<XDriveMediaDetailsContent/)
  assert.match(inspector, /anchor="bottom"/)
})
