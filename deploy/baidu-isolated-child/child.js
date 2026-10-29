// A3i-Msg4: real SDK and map rendering ONLY in independently hosted HTTPS Child.
// No Gallery API, JWT, Owner identity, thumbnail URL/pixels, or local storage.
// Parent sends a one-use map-only ticket before ANY provider script is loaded.
(() => {
  'use strict'
  const MAX_BYTES = 8192
  const MAX_CELLS = 64
  const MAX_PHOTO_COVERS = 64
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
  let cells = [], gestureCells = [], allowedKeys = new Set(), coveredKeys = new Set(), map = null, sdk = null
  let script = null, pending = false, disposed = false, sessionFailed = false, labelBindings = []
  let initialOverviewPending = true
  let viewportTimer = null, gestureFrame = null
  // The Child observes ONLY genuine local mouse pointer lifecycle; no
  // Owner/Photo scope or mouse coordinates enter the Parent protocol.
  let heldMousePointer = null, viewportAfterMouseRelease = false
  // No private data or pointer identifiers cross this isolated Origin.
  const heldTouchPointers = new Set()
  let observedSize = null, sizeObserver = null, windowResizeFallback = false
  let resizeRevoked = false
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
  const fitInitialOverview = () => {
    if (!initialOverviewPending || !map || !sdk || !active || disposed) return
    initialOverviewPending = false
    if (cells.length === 0) return
    try {
      const points = cells.map(cell => new sdk.Point(cell.longitude,cell.latitude))
      if (points.length === 1) {
        map.centerAndZoom(points[0],12)
      } else if (typeof map.setViewport === 'function') {
        map.setViewport(points,{margins:[64,64,64,64]})
      } else {
        const lat=cells.reduce((sum,cell)=>sum+cell.latitude,0)/cells.length
        const lon=cells.reduce((sum,cell)=>sum+cell.longitude,0)/cells.length
        map.centerAndZoom(new sdk.Point(lon,lat),3)
      }
    } catch { /* retain conservative global camera when SDK fitting fails */ }
  }
  const emitCellProjections = (gesture = false) => {
    if (!map || !sdk || !canvas || !active || disposed ||
        typeof map.pointToPixel !== 'function') return
    const width = Math.round(canvas.clientWidth)
    const height = Math.round(canvas.clientHeight)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > 4096 || height > 4096) return
    const points = []
    let validPixels = 0
    for (const cell of gesture ? gestureCells : cells) {
      if (!gesture && !allowedKeys.has(cell.key)) continue
      try {
        const position = map.pointToPixel(new sdk.Point(cell.longitude,cell.latitude))
        const x = Math.round(position.x), y = Math.round(position.y)
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) continue
        // An offscreen finite pixel is valid evidence that the marker left
        // the map. Do not mistake that for a transient SDK decode failure.
        validPixels++
        if (x < 0 || x > width || y < 0 || y > height) continue
        points.push({key:cell.key,x,y})
      } catch { /* old SDK: numerical cluster labels remain */ }
    }
    // During a held-mouse pan the provider can temporarily return NaN or
    // throw for every old position. Keep the last already-inert Parent photo
    // projection rather than sending an empty gesture frame. Child grants
    // remain revoked; no private Owner identity or media crosses this Origin.
    if (gesture && gestureCells.length>0 && validPixels===0) return
    send(gesture ? 'gesture-projections' : 'cell-projections',
      {width,height,points})
  }
  // The SDK owns the actual camera translation/zoom in its own Origin.
  // Project only the old bounded anonymous geometry while it moves;
  // NEVER restore allowed keys, click listeners or expired Owner authority.
  const projectGesture = () => {
    if (!gestureCells.length || gestureFrame !== null || !active || disposed) return
    if (typeof window.requestAnimationFrame !== 'function') {
      emitCellProjections(true)
      return
    }
    gestureFrame=window.requestAnimationFrame(()=>{
      gestureFrame=null
      if (gestureCells.length)emitCellProjections(true)
    })
  }
  const clearGesture = () => {
    gestureCells=[]
    if (gestureFrame!==null && typeof window.cancelAnimationFrame==='function')
      window.cancelAnimationFrame(gestureFrame)
    gestureFrame=null
  }
  const renderCells = (republishProjection = true) => {
    clearLabels()
    if (!map || !sdk || !active || disposed) return
    for (const cell of cells) {
      // An obsolete Child still has its prior array in memory immediately
      // after gesture cancellation, but its permitted keys are revoked.
      // Never recreate their numeric labels on a delayed cover update.
      // A current, permitted Parent photo overlay owns the entire visible
      // marker presentation. Never mix uncovered numeric SDK Labels with the
      // Parent's photo-first buttons; current Cells remain accessible in Parent.
      // Revoked or malformed cover keys cannot acquire this presentation lease.
      if (!allowedKeys.has(cell.key) || coveredKeys.size > 0) continue
      try {
        const label = new sdk.Label(cell.count > 1
          ? '▣ ' + cell.count.toLocaleString('zh-CN') + '张' : '▣', {
          position: new sdk.Point(cell.longitude,cell.latitude),
          // Native offset centers the fallback on the trusted Parent's SDK point.
          ...(typeof sdk.Size === 'function' ? {offset:new sdk.Size(-28,-28)} : {}),
        })
        label.setStyle({color:'#334155',backgroundColor:'#ffffff',
          borderColor:'#ffffff',borderWidth:'2px',
          padding:'9px 11px',borderRadius:'12px',
          boxShadow:'0 3px 12px rgba(15,23,42,.20)',
          cursor:'pointer',fontWeight:'700',fontSize:'12px',
          whiteSpace:'nowrap'})
        const key = cell.key
        const click = () => { if (!disposed && active && allowedKeys.has(key)) send('activate-cell',{key}) }
        label.addEventListener('click',click)
        map.addOverlay(label)
        labelBindings.push({label,click})
      } catch { clearLabels(); send('map-failed'); return }
    }
    if (republishProjection) emitCellProjections()
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
  // Coalesce SDK moveend + zoomend and repeated native settle events. The
  // Parent still cancels its current Owner query immediately at gesture START.
  const scheduleViewport = () => {
    projectGesture()
    if (viewportTimer !== null) clearTimeout(viewportTimer)
    viewportTimer = null
    // Some JSAPI versions emit moveend before the physical left button lifts.
    // Keep the old signed photo pixels as inert projections until pointerup.
    if (heldMousePointer !== null || heldTouchPointers.size > 0) {
      viewportAfterMouseRelease = true
      return
    }
    viewportTimer = setTimeout(() => {
      viewportTimer = null
      if (heldMousePointer !== null || heldTouchPointers.size > 0) {
        viewportAfterMouseRelease = true
        return
      }
      if (!disposed && active) emitViewport()
    }, 500)
  }
  const stopViewport = () => {
    if (heldMousePointer !== null || heldTouchPointers.size > 0)
      viewportAfterMouseRelease = true
    if (viewportTimer !== null) clearTimeout(viewportTimer)
    viewportTimer = null
    if (allowedKeys.size>0)gestureCells=cells.map(cell=>({...cell}))
    allowedKeys.clear()
    coveredKeys.clear()
    clearLabels()
    send('cancel')
    projectGesture()
  }
  // A resize (including a mobile rotation or container-width change)
  // invalidates earlier camera pixels and their Owner Cell keys just like
  // a real SDK gesture. Never keep photo covers attached to old CSS pixels.
  // The parent still owns the ONLY authorized /cells query after debounce.
  const onMousePointerDown = event => {
    if (disposed || !active || !map || !event.isTrusted || event.button!==0)
      return
    if (event.pointerType==='mouse' && event.isPrimary)
      heldMousePointer=event.pointerId
    else if (event.pointerType==='touch' || event.pointerType==='pen')
      heldTouchPointers.add(event.pointerId)
  }
  const releaseHeldMouse = pointerID => {
    const mouseMatches=heldMousePointer!==null &&
      (pointerID===undefined || pointerID===heldMousePointer)
    const touchMatches=pointerID===undefined
      ? heldTouchPointers.size>0 : heldTouchPointers.delete(pointerID)
    if (!mouseMatches && !touchMatches) return
    if (mouseMatches) heldMousePointer=null
    if (pointerID===undefined) heldTouchPointers.clear()
    // Multitouch pinch isn't settled until its final current contact lifts.
    if (heldMousePointer!==null || heldTouchPointers.size>0) return
    if (!viewportAfterMouseRelease) return
    viewportAfterMouseRelease=false
    if (!disposed && active && map) scheduleViewport()
  }
  const onMousePointerUp = event => {
    // The untrusted SDK must not end an actual drag using a forged
    // pointerup/pointercancel with a matching ID.
    if (!event.isTrusted) return
    releaseHeldMouse(event.pointerId)
  }
  const onMouseWindowBlur = event => {
    if (event.isTrusted) releaseHeldMouse()
  }
  const bindMousePointer = () => {
    // Cross-Origin SDK input stays entirely in the isolated Child.
    // Capture phase survives a provider's stopPropagation on its map DOM.
    canvas?.addEventListener('pointerdown',onMousePointerDown,true)
    window.addEventListener('pointerup',onMousePointerUp,true)
    window.addEventListener('pointercancel',onMousePointerUp,true)
    window.addEventListener('blur',onMouseWindowBlur)
  }
  const releaseMousePointer = () => {
    heldMousePointer=null
    heldTouchPointers.clear()
    viewportAfterMouseRelease=false
    canvas?.removeEventListener('pointerdown',onMousePointerDown,true)
    window.removeEventListener('pointerup',onMousePointerUp,true)
    window.removeEventListener('pointercancel',onMousePointerUp,true)
    window.removeEventListener('blur',onMouseWindowBlur)
  }
  const refreshChangedSize = () => {
    if (!active || disposed || !map || !canvas) return
    const width = Math.round(canvas.clientWidth)
    const height = Math.round(canvas.clientHeight)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 120 || height < 120 || width > 4096 || height > 4096) return
    if (!observedSize) { observedSize = {width,height}; return }
    if (observedSize.width === width && observedSize.height === height) return
    observedSize = {width,height}
    // The first resize revokes Owner keys immediately; subsequent frames
    // only extend the 500ms quiet window until a new signed Cell receipt.
    if (!resizeRevoked) { stopViewport(); resizeRevoked = true }
    scheduleViewport()
  }
  const observeCanvasSize = () => {
    refreshChangedSize() // Initial observer notification is not a gesture.
    if (typeof window.ResizeObserver === 'function') {
      try {
        sizeObserver = new window.ResizeObserver(refreshChangedSize)
        sizeObserver.observe(canvas)
        return
      } catch {
        try { sizeObserver?.disconnect() } catch {}
        sizeObserver = null
      }
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize',refreshChangedSize)
      windowResizeFallback = true
    }
  }
  const releaseCanvasSize = () => {
    try { sizeObserver?.disconnect() } catch {}
    sizeObserver = null
    if (windowResizeFallback && typeof window.removeEventListener === 'function')
      window.removeEventListener('resize',refreshChangedSize)
    windowResizeFallback = false
  }
  const bindNative = native => {
    if (disposed || !active || !canvas || typeof native.Map !== 'function' ||
        typeof native.Point !== 'function' || typeof native.Label !== 'function') throw Error('unavailable')
    sdk = native
    map = new native.Map(canvas)
    map.centerAndZoom(new native.Point(0,20),3)
    try {
      map.enableScrollWheelZoom?.(true)
      map.enableDoubleClickZoom?.(true)
      map.enablePinchToZoom?.(true)
    } catch { /* unsupported optional SDK gesture API */ }
    fitInitialOverview()
    map.addEventListener('movestart', stopViewport)
    map.addEventListener('zoomstart', stopViewport)
    map.addEventListener('moving', projectGesture)
    map.addEventListener('zooming', projectGesture)
    map.addEventListener('moveend', scheduleViewport)
    map.addEventListener('zoomend', scheduleViewport)
    bindMousePointer()
    renderCells()
    if (status) status.textContent = '百度地图'
    send('map-ready')
    emitCellProjections()
    scheduleViewport()
    observeCanvasSize()
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
    if (pending || sessionFailed || disposed || !active || !/^[a-f0-9]{64}$/.test(incoming)) return
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
      // This Child instance can never retry an invalid map-only redemption.
      // Parent may create a fresh, separately signed Child if authorized.
      if (!sessionFailed && !disposed) {
        sessionFailed=true
        releaseCanvasSize()
        clearLabels()
        allowedKeys.clear()
        coveredKeys.clear()
        clearGesture()
        releaseMousePointer()
        cells=[]
        try {map?.destroy?.()} catch {}
        map=null
        if(status)status.textContent='隔离地图会话或 SDK 不可用；地点列表和照片墙仍可使用。'
        send('map-failed')
      }
    } finally { ticket=''; pending=false }
  }
  const accept=event=>{
    if (!parentOrigin || event.origin!==parentOrigin || event.source!==window.parent ||
        disposed || sessionFailed || !isRecord(event.data)) return
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
      // An EMPTY replacement revokes current media permissions but leaves
      // a cosmetic geometry-only pan projection until fresh /cells arrives.
      if (data.cells.length>0)clearGesture()
      allowedKeys=next
      coveredKeys.clear()
      resizeRevoked=false
      fitInitialOverview()
      renderCells()
      if(!map && status)status.textContent='已建立隔离消息通道；等待仅用于地图的会话。'
    } else if(data.kind==='photo-covers') {
      // Cosmetic suppression only. The Child receives ephemeral current
      // Cell keys, never Owner identifiers, thumbnails or photo metadata.
      if (!active || !map || !exact(data,
          ['version','generation','nonce','kind','keys']) ||
          data.generation!==generation || data.nonce!==nonce ||
          !Array.isArray(data.keys) || data.keys.length>MAX_PHOTO_COVERS) return
      const next=new Set()
      for(const key of data.keys) {
        if (typeof key!=='string' || !/^[a-f0-9]{32}$/.test(key) ||
            next.has(key) || !allowedKeys.has(key)) return
        next.add(key)
      }
      coveredKeys=next
      renderCells(false)
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
        // Some SDK builds do not emit moveend after API-driven camera moves.
        // A Viewer return or late BD-09 backfill still needs a fresh Owner
        // Camera Range; share the native-event debounce to avoid duplicates.
        scheduleViewport()
      } catch { send('map-failed') }
    }
  }
  const dispose=()=>{
    clearGesture()
    releaseMousePointer()
    releaseCanvasSize()
    if (viewportTimer !== null) clearTimeout(viewportTimer)
    viewportTimer = null
    active=false;disposed=true;generation=0;nonce=''
    allowedKeys.clear();coveredKeys.clear();cells=[];clearLabels()
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
