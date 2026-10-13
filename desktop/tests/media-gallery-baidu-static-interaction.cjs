const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')
const root = path.resolve(__dirname, '../..')
const host = tag => ({ component, children, ...props }) => React.createElement(component || tag, props, children)
const mui = {
  Box: host('div'), Stack: host('div'), Typography: host('span'),
  IconButton: host('button'), Tooltip: ({ children }) => children,
}
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
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
  new Function('exports', 'module', 'require', js)(module.exports, module, localRequire)
  return module.exports
}
const { XDriveMediaGalleryBaiduStaticMap: BaiduMap } =
  load(path.join(root, 'ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx'))

test('A3 real shared Baidu view: drag release issues one new authorized map call and aborts old work', async () => {
  const requests = []
  const provider = async () => ({
    provider: 'baidu-server-static', enabled: true,
    attribution: '© 百度地图', privacy: 'GPS 请求会发送给百度',
  })
  const source = (input, signal) => {
    requests.push({ input, signal })
    return new Promise(() => {}) // deterministic pending upstream; abort is observable
  }
  const a = {
    id: 'place:1:2', name: '位置 A',
    latitude: 10.01, longitude: 20.01,
    sample_latitude: 10.012345, sample_longitude: 20.06789,
  }
  const b = {
    id: 'place:4:5', name: '位置 B',
    latitude: 11.01, longitude: 30.01,
    sample_latitude: 11.04, sample_longitude: 30.09,
  }
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(BaiduMap, {
        place: a, getProvider: provider, loadStaticMap: source,
      }))
    })
    assert.equal(requests.length, 1, 'initial authorized map request')
    assert.equal(requests[0].input.latitude, a.sample_latitude)
    assert.equal(requests[0].input.longitude, a.sample_longitude)
    const region = () => renderer.root.find(el =>
      el.type === 'div' && el.props.role === 'group')
    const dragArea = { clientWidth: 480, clientHeight: 280, setPointerCapture() {} }
    await act(async () => {
      region().props.onPointerDown({
        pointerId: 7, pointerType: 'touch', button: 0,
        clientX: 240, clientY: 140, currentTarget: dragArea,
      })
    })
    assert.equal(requests.length, 1, 'no per-pointer-move upstream requests')
    await act(async () => {
      region().props.onPointerUp({
        pointerId: 7, clientX: 140, clientY: 140, currentTarget: dragArea,
      })
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true, 'old Go/Agent request must receive abort signal')
    assert.ok(requests[1].input.longitude > a.sample_longitude)
    await act(async () => {
      region().props.onKeyDown({ key: 'ArrowUp', preventDefault() {} })
    })
    assert.equal(requests.length, 3)
    assert.equal(requests[1].signal.aborted, true)
    assert.ok(requests[2].input.latitude > requests[1].input.latitude)
    await act(async () => {
      renderer.update(React.createElement(BaiduMap, {
        place: b, getProvider: provider, loadStaticMap: source,
      }))
    })
    assert.equal(requests.length, 4)
    assert.equal(requests[2].signal.aborted, true)
    assert.equal(requests[3].input.latitude, b.sample_latitude,
      'changing the selected place resets camera to the new real GPS')
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(requests[3].signal.aborted, true)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})
