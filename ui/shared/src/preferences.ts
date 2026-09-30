export type XDriveAppearance = 'system' | 'light' | 'dark'

export const xDriveAppearanceOptions: Array<{ value: XDriveAppearance; label: string }> = [
  { value: 'light', label: '白天模式' },
  { value: 'dark', label: '黑夜模式' },
  { value: 'system', label: '跟随系统' },
]

export function normalizeXDriveAppearance(value: unknown): XDriveAppearance {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}
