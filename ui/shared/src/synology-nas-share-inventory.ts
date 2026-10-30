// A DSM share is a read-only package-user directory candidate, NOT an
// xDrive Source, a native Root grant or a Server file node.
export type XDriveSynologyNASShare = {
  label: string
  selection_id: string
}

export function xDriveValidateSynologyNASShareInventory(raw: unknown): XDriveSynologyNASShare[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'items')) {
    throw new Error('Invalid DSM NAS share inventory')
  }
  const rows = (raw as { items: unknown }).items
  if (!Array.isArray(rows) || rows.length > 512) {
    throw new Error('Invalid DSM NAS share count')
  }
  const labels = new Set<string>()
  const tokens = new Set<string>()
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
      Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, 'label') || !Object.hasOwn(row, 'selection_id')) {
      throw new Error('Invalid DSM NAS share row')
    }
    const { label, selection_id } = row as Record<string, unknown>
    if (typeof label !== 'string' || typeof selection_id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(selection_id) ||
      labels.has(label) || tokens.has(selection_id)) {
      throw new Error('Invalid or duplicate DSM NAS share')
    }
    const match = /^\/volume[1-9][0-9]{0,2}\/([^/\\]+)$/.exec(label)
    const name = match?.[1] || ''
    if (!name || new TextEncoder().encode(name).length > 255 ||
      name.startsWith('.') || name.startsWith('@') || name.startsWith('#') ||
      name.toLowerCase() === 'home' || name.toLowerCase() === 'homes' ||
      /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Unsafe DSM NAS share label')
    }
    labels.add(label)
    tokens.add(selection_id)
    // Copy only expected fields; never propagate private Agent/Root metadata.
    return { label, selection_id }
  })
}
