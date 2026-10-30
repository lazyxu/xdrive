/** A presentation-only category view of already authorized Web destinations.
 * Never mint routes or infer admin privileges from a category name. */
export type XDriveMobileLauncherSection<T> = {
  key: string
  label: string
  items: T[]
}

const categories = [
  { key: 'photos', label: '图库与相册', keys: ['gallery'] },
  { key: 'files', label: '文件与存储', keys: ['files', 'cloud-storage', 'local-storage'] },
  { key: 'backup', label: '备份与同步', keys: ['device-backup', 'remote-pull'] },
  { key: 'tasks', label: '任务与传输', keys: ['transfers'] },
  { key: 'admin', label: '管理', keys: [
    'admin-users', 'admin-audit', 'admin-storage', 'admin-services', 'admin-maintenance',
  ] },
] as const

export function xDriveMobileLauncherSections<T extends { key: string }>(
  allowedDestinations: readonly T[],
): XDriveMobileLauncherSection<T>[] {
  const remaining = new Map(allowedDestinations.map(item => [item.key, item]))
  const sections: XDriveMobileLauncherSection<T>[] = []
  for (const category of categories) {
    const items: T[] = []
    for (const key of category.keys) {
      const destination = remaining.get(key)
      if (!destination) continue
      items.push(destination)
      remaining.delete(key)
    }
    if (items.length) sections.push({ key: category.key, label: category.label, items })
  }
  if (remaining.size) {
    sections.push({ key: 'other', label: '其他功能', items: [...remaining.values()] })
  }
  return sections
}
