export type XDriveWebTextSelection = {
  start: number
  end: number
}

export function xDriveWebTextSelection(
  text: string,
  line: number,
  column = 1,
): XDriveWebTextSelection {
  const lines = text.split('\n')
  const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.max(1, line) - 1))
  let lineStart = 0
  for (let index = 0; index < lineIndex; index += 1) {
    lineStart += lines[index].length + 1
  }
  const rawLine = lines[lineIndex] || ''
  const visibleLine = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
  const lineEnd = lineStart + visibleLine.length
  const columnOffset = Math.max(0, Math.max(1, column) - 1)
  const start = Math.min(lineEnd, lineStart + columnOffset)
  return { start, end: lineEnd }
}
