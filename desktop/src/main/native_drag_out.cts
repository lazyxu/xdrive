import { realpathSync, statSync } from 'node:fs'
import path = require('node:path')

export function desktopNativeDragOutSupported(platform = process.platform) {
  return platform === 'win32' || platform === 'darwin'
}

export function resolveDesktopNativeDragOutPath(
  mountPathValue: string | null | undefined,
  relativePathValue: string,
) {
  const mountPath = (mountPathValue ?? '').trim()
  const relativePath = relativePathValue.trim()
  if (!mountPath) throw new Error('xDrive mount path is unavailable.')
  if (
    !relativePath ||
    relativePath.includes('\0') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('A safe relative xDrive path is required.')
  }

  const root = realpathSync(mountPath)
  const requested = path.resolve(root, relativePath)
  const resolved = realpathSync(requested)
  const within = path.relative(root, resolved)
  if (
    !within ||
    within === '..' ||
    within.startsWith(`..${path.sep}`) ||
    path.isAbsolute(within)
  ) {
    throw new Error('The drag source is outside the xDrive mount root.')
  }

  const info = statSync(resolved)
  if (!info.isFile() && !info.isDirectory()) {
    throw new Error('The drag source is not a file or directory.')
  }
  return resolved
}
