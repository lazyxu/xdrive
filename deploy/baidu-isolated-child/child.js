// A3i-Msg4: real SDK and map rendering ONLY in independently hosted HTTPS Child.
// No Gallery API, JWT, Owner identity, thumbnail URL/pixels, or local storage.
// Parent sends a one-use map-only ticket before ANY provider script is loaded.
(() => {
  'use strict'
  const MAX_BYTES = 8192
  const MAX_CELLS = 64
  const status = document.getElementById('xdrive-isolated-map-status')
  const canvas = document.getElementById('xdrive-isolated-map-canvas')
  const validOrigin = value => {
    if (typeof value !== 'string' || !value.startsWith('https://') || value.length > 253) return false
    try {
      const url = new URL(value)
      return url.origin === value && url.protocol === 'https:' && !url.username &&
        !url.password && url.pathname === '/' && !url.search && !url.hash
    } catch { return false }
  }
  const siteSuffix = origin => {
    try {
      const host = new URL(origin).hostname.toLowerCase()
      if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') ||
          /^\d+(?:\.\d+){3}$/.test(host)) return null
      const labels = host.split('.')
      if (labels.length < 2 || labels.some(label => label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
      return labels.slice(-2).join('.')
    } catch { return null }
  }
  const isRecord = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  const exact = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key))
  const validCell = value => exact(value, ['key','latitude','longitude','count']) &&
    typeof value.key === 'string' && /^[a-f0-9]{32}$/.test(value.key) &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) &&
    value.latitude >= -85 && value.latitude <= 85 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) &&
    value.longitude >= -180 && value.longitude <= 180 &&
    Number.isSafeInteger(value.count) && value.count >= 1 && value.count <= 100_000_000
  const validCamera = value => exact(value,
    ['coordinate_space','latitude','longitude','zoom']) &&
    value.coordinate_space === 'bd09ll' &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) &&
    value.latitude >= -85 && value.latitude <= 85 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) &&
    value.longitude >= -180 && value.longitude <= 180 &&
    Number.isInteger(value.zoom) && value.zoom >= 3 && value.zoom <= 18
  const validEnvelope = data => isRecord(data) && data.version === 1 &&
    Number.isSafeInteger(data.generation) && data.generation > 0 &&
    typeof data.nonce === 'string' && /^[a-f0-9]{32,64}$/.test(data.nonce) &&
    new TextEncoder().encode(JSON.stringify(data)).length <= MAX_BYTES
  let active = false, parentOrigin = '', generation = 0, nonce = ''
  let cells = [], allowedKeys = new Set(), map = null, sdk = null
  let script = null, pending = false, disposed = false, labelBindings = []
  const send = (kind, fields = {}) => {
    if (!active || disposed) return
    window.parent.postMessage(Object.assign({version:1,generation,nonce,kind},fields),parentOrigin)
  }
  const clearLabels = () => {
    for (const binding of labelBindings) {
      try { binding.label.removeEventListener('click',binding.click) } catch {}
      try { map && map.removeOverlay(binding.label) } catch {}
    }
    labelBindings = []
  }
  const renderCells = () => {
    clearLabels()
    if (!map || !sdk || !active || disposed) return
    for (const cell of cells) {
      try {
        const label = new sdk.Label(String(cell.count), {
          position: new sdk.Point(cell.longitude,cell.latitude),
        })
        label.setStyle({color:'#fff',backgroundColor:'#287cf4',borderColor:'#fff',
          borderWidth:'2px',padding:'5px 9px',borderRadius:'18px',
          cursor:'pointer',fontSize:'13px'})
        const key = cell.key
        const click = () => { if (!disposed && active && allowedKeys.has(key)) send('activate-cell',{key}) }
        label.addEventListener('click',click)
        map.addOverlay(label)
        labelBindings.push({label,click})
      } catch { clearLabels(); send('map-failed'); return }
    }
  }
  const emitViewport = () => {
    if (!map || !active || disposed) return
    try {
      const bounds = map.getBounds()
      const sw = bounds.getSouthWest(), ne = bounds.getNorthEast()
      const values = [sw.lng,sw.lat,ne.lng,ne.lat]
      if (values.some(value => !Number.isFinite(value)) ||
          Math.abs(sw.lng)>180 || Math.abs(ne.lng)>180 ||
          Math.abs(sw.lat)>85 || Math.abs(ne.lat)>85 ||
          sw.lat>=ne.lat || sw.lng===ne.lng) return
      send('viewport',{bounds:{coordinate_space:'bd09ll',
        west:sw.lng,south:sw.lat,east:ne.lng,north:ne.lat}})
      const center = map.getCenter()
      const zoom = map.getZoom()
      if (center && Number.isFinite(center.lng) && Number.isFinite(center.lat) &&
          Math.abs(center.lng)<=180 && Math.abs(center.lat)<=85 &&
          Number.isInteger(zoom) && zoom>=3 && zoom<=18) {
        send('camera',{camera:{coordinate_space:'bd09ll',
          latitude:center.lat,longitude:center.lng,zoom}})
      }
    } catch { /* provider errors are never passed to the trusted parent */ }
  }
  const bindNative = native => {
    if (disposed || !active || !canvas || typeof native.Map !== 'function' ||
        typeof native.Point !== 'function' || typeof native.Label !== 'function') throw Error('unavailable')
    sdk = native
    map = new native.Map(canvas)
    const sample = cells[0]
    map.centerAndZoom(new native.Point(sample ? sample.longitude : 116.4,
      sample ? sample.latitude : 39.9),sample ? 8 : 4)
    map.addEventListener('movestart', () => { allowedKeys.clear(); clearLabels(); send('cancel') })
    map.addEventListener('zoomstart', () => { allowedKeys.clear(); clearLabels(); send('cancel') })
    map.addEventListener('moveend', emitViewport)
    map.addEventListener('zoomend', emitViewport)
    renderCells()
    if (status) status.textContent = '百度地图'
    send('map-ready')
    emitViewport()
  }
  const loadSDK = () => new Promise((resolve,reject) => {
    if (script || disposed || !active) { reject(Error('unavailable')); return }
    const configured = window._BMapSecurityConfig
    const serviceHost = window.location.origin + '/_BMapService/'
    if (configured && configured.serviceHost !== serviceHost) { reject(Error('unavailable')); return }
    window._BMapSecurityConfig = {serviceHost}
    script = document.createElement('script')
    script.async = true
    script.referrerPolicy = 'no-referrer'
    script.src = '/_BMapService/api?v=4.0'
    let settled = false, poll = null
    const stop = ok => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (poll) clearTimeout(poll)
      if (script) { script.onload = null;script.onerror = null }
      if (ok) resolve(window.BMap)
      else { script?.remove(); script=null; reject(Error('unavailable')) }
    }
    const check = () => {
      if (disposed || !active) { stop(false); return }
      let ns = null
      try { ns=window.BMap } catch {}
      if (ns && typeof ns.Map==='function' && typeof ns.Point==='function' &&
          typeof ns.Label==='function') stop(true)
      else poll = setTimeout(check,80)
    }
    const timer=setTimeout(()=>stop(false),7500)
    script.onload=check
    script.onerror=()=>stop(false)
    try { document.head.appendChild(script) } catch { stop(false) }
  })
  const redeem = async incoming => {
    if (pending || disposed || !active || !/^[a-f0-9]{64}$/.test(incoming)) return
    pending=true
    let ticket=incoming
    try {
      const response=await fetch('/_xdrive_baidu_isolated/session',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ticket}),
      })
      ticket=''
      if (!response.ok || disposed || !active) throw Error('unavailable')
      const receipt=await response.json()
      if (!exact(receipt,['provider','runtime_enabled']) ||
          receipt.provider!=='baidu-jsapi-4.0' || receipt.runtime_enabled!==true) throw Error('unavailable')
      if (!map) bindNative(await loadSDK())
    } catch {
      clearLabels()
      try {map?.destroy?.()} catch {}
      map=null
      if(status)status.textContent='隔离地图会话或 SDK 不可用，保留图库静态地图。'
      send('map-failed')
    } finally { ticket=''; pending=false }
  }
  const accept=event=>{
    if (!parentOrigin || event.origin!==parentOrigin || event.source!==window.parent ||
        disposed || !isRecord(event.data)) return
    const data=event.data
    try { if (!validEnvelope(data)) return } catch { return }
    if (data.kind==='cells') {
      if (!exact(data,['version','generation','nonce','kind','cells']) ||
          !Array.isArray(data.cells) || data.cells.length>MAX_CELLS) return
      const next=new Set()
      for(const cell of data.cells) {
        if(!validCell(cell)||next.has(cell.key))return
        next.add(cell.key)
      }
      if(!active) {
        if(data.cells.length!==0)return
        active=true;generation=data.generation;nonce=data.nonce
        send('ready')
      } else if(generation!==data.generation || nonce!==data.nonce) { dispose();return }
      cells=data.cells.map(cell=>({key:cell.key,latitude:cell.latitude,
        longitude:cell.longitude,count:cell.count}))
      allowedKeys=next
      renderCells()
      if(!map && status)status.textContent='已建立隔离消息通道；等待仅用于地图的会话。'
    } else if(data.kind==='map-session') {
      if (!active || !exact(data,['version','generation','nonce','kind','ticket']) ||
          data.generation!==generation || data.nonce!==nonce ||
          typeof data.ticket!=='string' || !/^[a-f0-9]{64}$/.test(data.ticket))return
      void redeem(data.ticket)
    } else if (data.kind==='restore-camera') {
      // Camera return never authorizes a photo or arbitrary media range.
      if (!active || !map || !sdk ||
          data.generation!==generation || data.nonce!==nonce ||
          !exact(data,['version','generation','nonce','kind','camera']) ||
          !validCamera(data.camera)) return
      try {
        map.centerAndZoom(
          new sdk.Point(data.camera.longitude,data.camera.latitude),
          data.camera.zoom)
      } catch { send('map-failed') }
    }
  }
  const dispose=()=>{
    active=false;disposed=true;generation=0;nonce=''
    allowedKeys.clear();cells=[];clearLabels()
    try { map?.destroy?.() } catch {}
    map=null
    script?.remove();script=null
  }
  const startup=()=>{
    if(window.parent===window || !validOrigin(window.location.origin))return
    const approved=document.querySelector('meta[name="xdrive-isolated-parent-origin"]')?.content
    if(!validOrigin(approved)||approved===window.location.origin ||
        !siteSuffix(approved)||!siteSuffix(window.location.origin)||
        siteSuffix(approved)===siteSuffix(window.location.origin))return
    parentOrigin=approved
    window.addEventListener('message',accept)
    window.addEventListener('pagehide',dispose)
  }
  try{startup()}catch{dispose()}
})()
