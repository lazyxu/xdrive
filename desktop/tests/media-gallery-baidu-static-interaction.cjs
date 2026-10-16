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


test('A3 shared Mobile Web/Desktop two-pointer pinch commits one zoom, never a fake pan', async () => {
  const requests = []
  const provider = async () => ({
    provider: 'baidu-server-static', enabled: true,
    attribution: '© 百度地图', privacy: '地图坐标经 Server 处理',
  })
  const load = (input, signal) => {
    requests.push({ input, signal })
    return new Promise(() => {})
  }
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(BaiduMap, {
        location: { latitude: 0, longitude: 0, name: '赤道照片' },
        getProvider: provider, loadStaticMap: load,
      }))
    })
    assert.equal(requests.length, 1)
    const region = () => renderer.root.find(el =>
      el.type === 'div' && el.props.role === 'group')
    const surface = { clientWidth: 480, clientHeight: 280, setPointerCapture() {} }
    const pointer = (id, x, y) => ({
      pointerId: id, pointerType: 'touch', button: 0,
      clientX: x, clientY: y, currentTarget: surface,
    })

    await act(async () => {
      region().props.onPointerDown(pointer(1, 100, 140))
      region().props.onPointerDown(pointer(2, 200, 140))
      region().props.onPointerMove(pointer(2, 300, 140))
    })
    assert.equal(requests.length, 1, 'no PNG request during gesture movement')
    await act(async () => { region().props.onPointerUp(pointer(2, 300, 140)) })
    assert.equal(requests.length, 2, 'exactly one map PNG after pinch release')
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests[1].input.zoom, 13, '2x pinch increases one discrete zoom')
    assert.equal(requests[1].input.latitude, 0, 'real 0/0 GPS remains valid')
    assert.equal(requests[1].input.longitude, 0)
    await act(async () => { region().props.onPointerUp(pointer(1, 100, 140)) })
    assert.equal(requests.length, 2, 'trailing finger must not become a pan')

    await act(async () => {
      region().props.onPointerDown(pointer(3, 110, 120))
      region().props.onPointerDown(pointer(4, 210, 120))
      region().props.onPointerMove(pointer(4, 20, 120))
      region().props.onPointerCancel(pointer(4, 20, 120))
      region().props.onPointerUp(pointer(3, 110, 120))
    })
    assert.equal(requests.length, 2, 'canceled pinch cannot change camera')
    await act(async () => {
      region().props.onPointerDown(pointer(5, 200, 150))
      region().props.onPointerMove(pointer(5, 90, 150))
      region().props.onPointerUp(pointer(5, 90, 150))
    })
    assert.equal(requests.length, 3, 'ordinary single-pointer pan remains usable')
    assert.equal(requests[1].signal.aborted, true)
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(requests[2].signal.aborted, true)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})


test('A3 shared static map retains old raster only within same place, discards late PNGs', async () => {
  const requests = []
  const created = [], revoked = []
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const provider = async () => ({
    provider: 'baidu-server-static', enabled: true,
    attribution: '© 百度地图', privacy: 'Server 代理百度地图',
  })
  const source = (input, signal) => new Promise(resolve => {
    requests.push({ input, signal, resolve })
  })
  const a = { id: 'place:0:0', name: '地点 A', latitude: 0.005, longitude: 0.005,
    sample_latitude: 0, sample_longitude: 0 }
  const b = { id: 'place:1:1', name: '地点 B', latitude: 1.005, longitude: 1.005,
    sample_latitude: 1.002, sample_longitude: 1.003 }
  const image = () => renderer.root.findAll(el =>
    el.type === 'img' && typeof el.props.src === 'string' &&
    el.props.src.startsWith('blob:fake-map-'))
  let renderer
  try {
    URL.createObjectURL = () => {
      const value = 'blob:fake-map-' + (created.length + 1)
      created.push(value)
      return value
    }
    URL.revokeObjectURL = value => revoked.push(value)
    await act(async () => {
      renderer = create(React.createElement(BaiduMap,
        { place: a, getProvider: provider, loadStaticMap: source }))
    })
    assert.equal(requests.length, 1)
    await act(async () => { requests[0].resolve(new Blob(['first'])) })
    assert.equal(image().length, 1)
    assert.equal(image()[0].props.src, 'blob:fake-map-1')
    const zoomIn = () => renderer.root.findAll(el => el.type === 'button' &&
      el.props['aria-label'] === '放大百度地图')[0]
    await act(async () => { zoomIn().props.onClick() })
    assert.equal(requests.length, 2)
    assert.equal(image()[0].props.src, 'blob:fake-map-1',
      'do not flash empty map while the same place camera refreshes')
    assert.match(image()[0].props.alt, /上一视窗/)
    await act(async () => { image()[0].props.onError() })
    assert.equal(image().length, 1,
      'an old raster decode error must not hide the newer active camera request')
    assert.deepEqual(revoked, [], 'old Blob stays usable until new frame commits')
    await act(async () => { requests[1].resolve(new Blob(['second'])) })
    assert.equal(image()[0].props.src, 'blob:fake-map-2')
    assert.ok(revoked.includes('blob:fake-map-1'), 'retired URL released after new DOM commit')
    assert.doesNotMatch(image()[0].props.alt, /上一视窗/)

    await act(async () => { zoomIn().props.onClick() })
    assert.equal(requests.length, 3)
    assert.equal(image()[0].props.src, 'blob:fake-map-2')
    await act(async () => {
      renderer.update(React.createElement(BaiduMap,
        { place: b, getProvider: provider, loadStaticMap: source }))
    })
    assert.equal(requests.length, 4)
    assert.equal(requests[2].signal.aborted, true)
    assert.equal(image().length, 0,
      'never show another place previous raster even before new request resolves')
    assert.ok(revoked.includes('blob:fake-map-2'))
    await act(async () => { requests[2].resolve(new Blob(['late stale'])) })
    assert.equal(created.length, 2, 'late aborted Server response makes no Blob URL')
    assert.equal(image().length, 0)
    await act(async () => { requests[3].resolve(new Blob(['new place'])) })
    assert.equal(image()[0].props.src, 'blob:fake-map-3')
    assert.equal(requests[3].input.latitude, b.sample_latitude)
    await act(async () => renderer.unmount())
    renderer = null
    assert.ok(revoked.includes('blob:fake-map-3'),
      'last committed Blob URL is released at unmount')
    assert.equal(new Set(revoked).size, created.length,
      'all created Blob URLs are revoked exactly once')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test('A3 shared Mobile Web/Desktop pinch anchors the finger centroid and pans without zoom', async () => {
  const requests = []
  const provider = async () => ({
    provider: 'baidu-server-static', enabled: true,
    attribution: '© 百度地图', privacy: 'Server map only',
  })
  const source = (input, signal) => {
    requests.push({ input, signal })
    return new Promise(() => {})
  }
  const surface = {
    clientWidth: 480, clientHeight: 280, setPointerCapture() {},
    getBoundingClientRect() {
      return { left: 20, top: 10, width: 480, height: 280 }
    },
  }
  const pointer = (id, x, y) => ({
    pointerId: id, pointerType: 'touch', button: 0,
    clientX: x + 20, clientY: y + 10, currentTarget: surface,
  })
  const loc = { latitude: 39.916, longitude: 116.404, name: '有焦点的真实照片' }
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(BaiduMap, {
        location: loc, getProvider: provider, loadStaticMap: source,
      }))
    })
    assert.equal(requests.length, 1)
    const region = () => renderer.root.find(el =>
      el.type === 'div' && el.props.role === 'group')
    await act(async () => {
      region().props.onPointerDown(pointer(1, 260, 140))
      region().props.onPointerDown(pointer(2, 380, 140))
      region().props.onPointerMove(pointer(1, 200, 140))
      region().props.onPointerMove(pointer(2, 440, 140))
    })
    assert.equal(requests.length, 1, 'no per-frame PNG loading during pinch')
    await act(async () => { region().props.onPointerUp(pointer(2, 440, 140)) })
    assert.equal(requests.length, 2, 'one bounded Server request at pinch commit')
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests[1].input.zoom, 13)
    assert.ok(requests[1].input.longitude > loc.longitude,
      'east-of-center pinch keeps the geographic anchor in the screen')
    await act(async () => { region().props.onPointerUp(pointer(1, 200, 140)) })
    assert.equal(requests.length, 2)

    await act(async () => {
      region().props.onPointerDown(pointer(3, 260, 140))
      region().props.onPointerDown(pointer(4, 360, 140))
      region().props.onPointerMove(pointer(3, 340, 140))
      region().props.onPointerMove(pointer(4, 440, 140))
    })
    assert.equal(requests.length, 2, 'two-finger move still issues no interim requests')
    await act(async () => { region().props.onPointerUp(pointer(4, 440, 140)) })
    assert.equal(requests.length, 3, 'one PNG on two-finger translation')
    assert.equal(requests[2].input.zoom, 13, 'translation keeps zoom unchanged')
    assert.ok(requests[2].input.longitude < requests[1].input.longitude,
      'camera moves west as the two-finger centroid moves east')
    assert.equal(requests[1].signal.aborted, true)
    await act(async () => { region().props.onPointerUp(pointer(3, 340, 140)) })
    assert.equal(requests.length, 3)
    await act(async () => {
      region().props.onPointerDown(pointer(5, 220, 140))
      region().props.onPointerDown(pointer(6, 320, 140))
      region().props.onPointerUp(pointer(6, 320, 140))
      region().props.onPointerUp(pointer(5, 220, 140))
    })
    assert.equal(requests.length, 3, 'stationary pinch does not re-request')
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(requests[2].signal.aborted, true)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})
