import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { XDriveFilePreviewSurface } from '__SURFACE__'

// This fixture holds URL tickets and decode completion independently. Native
// image decoding still runs, so the component exercises real browser images.
const harness = ((window as any).previewHarness = { events: [] as any[] }) as any
const tickets = new Map<string, (url: string) => void>()
const thumbnails = new Map<string, (url: string) => void>()
const decodeGates = new Map<string, () => void>()
const nativeDecode = HTMLImageElement.prototype.decode

HTMLImageElement.prototype.decode = async function () {
  const src = this.src
  await nativeDecode.call(this)
  if (src.includes('/original.png')) {
    const id = new URL(src).searchParams.get('id')!
    harness.events.push({ kind: 'decode-ready', id, connected: this.isConnected })
    await new Promise<void>((resolve) => decodeGates.set(id, resolve))
    harness.events.push({ kind: 'decode-released', id })
  }
}

const loadOriginal = (target: any) => {
  harness.events.push({ kind: 'ticket', id: target.id })
  return new Promise<string>((resolve) => tickets.set(target.id, resolve))
}
const loadThumbnail = async (target: any) => {
  harness.events.push({ kind: 'thumb', id: target.id })
  return target.id === 'live'
    ? new Promise<string>((resolve) => thumbnails.set(target.id, resolve))
    : `/thumb.png?id=${target.id}`
}

function App() {
  const [target, setTarget] = useState<any>(null)
  const [transformed, setTransformed] = useState(false)
  harness.open = (id: string, transform = false) => flushSync(() => {
    setTransformed(transform)
    setTarget({
      id,
      name: id === 'live' ? 'photo.livp' : `${id}.png`,
      kind: 'file',
      mimeType: 'image/png',
      revision: 1,
    })
  })
  harness.close = () => flushSync(() => setTarget(null))
  return (
    <div style={{ width: 500, height: 500, background: '#eee' }}>
      <XDriveFilePreviewSurface
        target={target}
        loadImagePreview={loadThumbnail}
        loadPreviewURL={loadOriginal}
        minHeight={500}
        maxHeight={500}
        mediaTransform={transformed ? { rotationDegrees: 90 } : undefined}
        fallback={<span>fallback</span>}
      />
    </div>
  )
}

harness.releaseThumb = (id: string) => thumbnails.get(id)?.(`/thumb.png?id=${id}`)
harness.releaseTicket = (id: string) => tickets.get(id)?.(`/original.png?id=${id}`)
harness.releaseDecode = (id: string) => decodeGates.get(id)?.()
createRoot(document.getElementById('root')!).render(<App />)
