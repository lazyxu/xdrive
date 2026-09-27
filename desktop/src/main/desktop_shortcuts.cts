export type DesktopShortcutAction = 'open-folder' | 'sync-now' | 'transfers' | 'settings'

const allowedActions = new Set<DesktopShortcutAction>([
  'open-folder',
  'sync-now',
  'transfers',
  'settings',
])

export function desktopShortcutActionFromArgs(args: readonly string[]): DesktopShortcutAction | null {
  for (const arg of args) {
    if (!arg.startsWith('--desktop-action=')) continue
    const value = arg.slice('--desktop-action='.length) as DesktopShortcutAction
    return allowedActions.has(value) ? value : null
  }
  return null
}

export function desktopShortcutShowsWindow(action: DesktopShortcutAction | null) {
  return action === 'transfers' || action === 'settings'
}

export function windowsUserTasks(program: string) {
  const iconPath = program
  const task = (action: DesktopShortcutAction, title: string, description: string) => ({
    program,
    arguments: `--desktop-action=${action}`,
    iconPath,
    iconIndex: 0,
    title,
    description,
  })
  return [
    task('open-folder', '打开 xDrive 文件夹', '在文件资源管理器中打开 xDrive 同步文件夹'),
    task('sync-now', '立即同步', '立即执行一次 xDrive 同步'),
    task('transfers', '查看传输', '打开 xDrive 桌面版的传输页面'),
    task('settings', '客户端设置', '打开 xDrive 桌面版的设置页面'),
  ]
}
