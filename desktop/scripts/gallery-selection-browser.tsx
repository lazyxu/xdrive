import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { XDriveMediaGallerySelectionToolbar } from '@probe/toolbar'
import { XDriveAppearanceThemeProvider } from '@probe/theme'

const stamp = '2026-10-09T12:00:00Z'
const albums = Array.from({ length: 24 }, (_, index) => ({
  id: `manual-${index + 1}`, revision: index + 7, kind: 'manual' as const,
  name: index === 0 ? '家庭相册' : `手动相册 ${String(index + 1).padStart(2, '0')} 长名称仍需完整可读`,
  item_count: index + 2, created_at: stamp, updated_at: stamp,
}))
const smartAlbum = { id: 'smart-1', revision: 7, kind: 'smart' as const,
  name: '自动规则相册', item_count: 12, created_at: stamp, updated_at: stamp }
const initialSelection = new Map([[101, { id: 101, revision: 7 }], [102, { id: 102, revision: 8 }]])
const probe = ((window as any).selectionPickerProbe = {
  calls: [] as any[], nextAlbumError: '', replaceSelection: (_ids: number[]) => {},
})
const record = async (kind: string, value?: unknown) => { probe.calls.push({ kind, value }) }

function Fixture() {
  const [selection, setSelection] = useState(initialSelection)
  useEffect(() => {
    probe.replaceSelection = ids => setSelection(new Map(ids.map(id => [id, { id, revision: 7 }])))
  }, [])
  return (
  <XDriveAppearanceThemeProvider appearance="light">
    <main aria-label="图库测试内容" style={{ padding: 12, height: '100%', overflow: 'auto' }}>
      <XDriveMediaGallerySelectionToolbar selectedCount={selection.size} selectionIdentity={selection}
        allFavorite={false} albums={[...albums, smartAlbum]}
        onFavorite={value => record('favorite', value)}
        onAddToAlbum={async album => {
          await record('add-to-album', { id: album.id, revision: album.revision })
          if (probe.nextAlbumError) {
            const message = probe.nextAlbumError
            probe.nextAlbumError = ''
            throw new Error(message)
          }
        }}
        onAddTags={tags => record('tags', tags)}
        onDownload={() => record('download')}
        onCreateCollage={() => { void record('collage') }}
        onCreateMovie={() => { void record('movie') }}
        onDelete={() => record('delete')}
        onClear={() => { void record('exit') }} />
      <p>已选媒体仍留在图库上下文内</p>
    </main>
  </XDriveAppearanceThemeProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
