'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const host = tag => ({ component, children, ...props }) =>
  React.createElement(component || tag, props, children)
const mui = {
  Box: host('div'), Stack: host('div'), Typography: host('span'),
  IconButton: host('button'), Tooltip: ({ children }) => children,
}
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  function localRequire(name) {
    if (name === '@mui/material') return mui
    if (name.startsWith('@mui/icons-material/')) return () => null
    if (!name.startsWith('.')) return require(name)
    const base = path.resolve(path.dirname(filename), name)
    const target = [base + '.ts', base + '.tsx'].find(fs.existsSync)
    return target ? load(target, cache) : require(base)
  }
  new Function('exports', 'module', 'require', js)(mod.exports, mod, localRequire)
  return mod.exports
}
const { XDriveMediaGalleryBaiduStaticMap: BaiduMap } =
  load(path.join(root, 'ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx'))

test('A3 shared Web/Mobile Web/Desktop map never substitutes grid center for missing photo GPS', async () => {
  const provider = async () => ({
    provider: 'baidu-server-static', enabled: true,
    attribution: '© 百度地图', privacy: '仅经 Server 发送真实 GPS',
  })
  const requests = []
  const source = (input, signal) => {
    requests.push({ input, signal })
    return new Promise(() => {})
  }
  const gridOnly = {
    id: 'place:0:0', name: '旧服务只返回网格中心',
    latitude: 0.005, longitude: 0.005,
  }
  const partial = { ...gridOnly, sample_latitude: 35.23456 }
  const exactZero = { ...gridOnly, sample_latitude: 0, sample_longitude: 0 }
  let renderer
  const view = (place) => React.createElement(BaiduMap, {
    place, getProvider: provider, loadStaticMap: source,
  })
  try {
    await act(async () => { renderer = create(view(gridOnly)) })
    assert.equal(requests.length, 0, 'grid center is not a real camera coordinate')
    const statusText = () => renderer.root.findAll(el => el.props.role === 'status')
      .flatMap(el => el.children.filter(x => typeof x === 'string')).join(' ')
    assert.match(statusText(), /缺少代表照片的真实 GPS 坐标/)
    let region = renderer.root.find(el => el.props.role === 'group')
    assert.equal(region.props.tabIndex, -1)
    assert.equal(region.props.sx.touchAction, 'auto',
      'disabled map must not trap mobile page scrolling')

    await act(async () => { renderer.update(view(partial)) })
    assert.equal(requests.length, 0, 'never combine one real GPS value with a grid-center value')

    await act(async () => { renderer.update(view(exactZero)) })
    assert.equal(requests.length, 1, '0/0 is a legitimate exact photographic GPS point')
    assert.deepEqual(
      [requests[0].input.latitude, requests[0].input.longitude], [0, 0],
    )
    assert.notEqual(requests[0].input.latitude, gridOnly.latitude)
    region = renderer.root.find(el => el.props.role === 'group')
    assert.equal(region.props.tabIndex, 0)

    await act(async () => { renderer.update(view(gridOnly)) })
    assert.equal(requests[0].signal.aborted, true,
      'loss of real GPS must abort the previous Server/Agent map request')
    assert.equal(requests.length, 1)
    assert.match(statusText(), /缺少代表照片的真实 GPS 坐标/)

    await act(async () => {
      renderer.update(React.createElement(BaiduMap, {
        location: { latitude: 0, longitude: 0, name: 'Viewer exact GPS' },
        getProvider: provider, loadStaticMap: source,
      }))
    })
    assert.equal(requests.length, 2, 'Viewer exact GPS must still render through shared Static API')
    assert.deepEqual(
      [requests[1].input.latitude, requests[1].input.longitude], [0, 0],
    )
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
  }
  assert.equal(requests[1].signal.aborted, true)
})
