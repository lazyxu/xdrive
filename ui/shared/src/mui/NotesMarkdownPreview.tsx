import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Box, Link, Stack, Typography } from '@mui/material'

import {
  xDriveNotesSafeRelativeAsset,
  xDriveNotesSafeExternalLink,
} from '../notes-markdown-policy'

export { xDriveNotesSafeRelativeAsset, xDriveNotesSafeExternalLink }

export type XDriveNotesImageResolver = (relativeAssetPath: string) => string | null

/** No raw HTML or arbitrary remote images. Only a Host-authenticated Owner
 * asset resolver may provide URL bytes for a safe relative Notes path. */
function inlineMarkdown(value: string): ReactNode[] {
  // React escapes all text. No untrusted HTML is ever mounted.
  const tokens = /(!?\[([^\]]{0,180})\]\(([^)\s]{1,500})\)|\*\*([^*]+)\*\*|\x60([^\x60]+)\x60|\*([^*\n]+)\*)/g
  const output: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tokens.exec(value)) !== null) {
    if (match.index > cursor) output.push(value.slice(cursor, match.index))
    const index = output.length
    if (match[1]?.startsWith('!')) {
      output.push(match[2] || '图片')
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const href = xDriveNotesSafeExternalLink(match[3])
      output.push(href
        ? <Link key={index} href={href} rel="noopener noreferrer" target="_blank">{match[2]}</Link>
        : match[2])
    } else if (match[4]) {
      output.push(<strong key={index}>{match[4]}</strong>)
    } else if (match[5]) {
      output.push(<Box key={index} component="code" sx={{
        bgcolor: 'action.hover', borderRadius: 0.5, px: 0.5, fontFamily: 'monospace',
      }}>{match[5]}</Box>)
    } else if (match[6]) {
      output.push(<em key={index}>{match[6]}</em>)
    } else {
      output.push(match[0])
    }
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) output.push(value.slice(cursor))
  return output
}

function NotesImage({ alt, assetPath, resolveImage }: {
  alt: string
  assetPath: string
  resolveImage?: XDriveNotesImageResolver
}) {
  const url = xDriveNotesSafeRelativeAsset(assetPath) ? resolveImage?.(assetPath) : null
  return url
    ? <Box component="img" src={url} alt={alt} loading="lazy"
        referrerPolicy="no-referrer"
        sx={{ maxWidth: '100%', maxHeight: 580, objectFit: 'contain', borderRadius: 1 }} />
    : <Typography component="span" color="text.secondary" variant="caption">
        [图片：{alt || assetPath}；尚未提供已授权的笔记附件]
      </Typography>
}

/** Bounded basic Markdown preview for text-first MVP. Unsupported GFM syntax
 * stays visible as text, rather than being treated as HTML or silently lost. */
export function XDriveNotesMarkdownPreview({ markdown, resolveImage }: {
  markdown: string
  resolveImage?: XDriveNotesImageResolver
}) {
  const blocks = useMemo(() => {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
    const result: ReactNode[] = []
    let fence: string[] | null = null
    let ordered = 0
    const flushCode = (key: string) => {
      if (fence !== null) {
        result.push(<Box key={key} component="pre" sx={{
          overflowX: 'auto', bgcolor: 'action.hover', p: 2, borderRadius: 1,
          fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}>{fence.join('\n')}</Box>)
        fence = null
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const value = lines[i]
      const key = String(i)
      if (value.startsWith('\x60\x60\x60')) {
        if (fence !== null) flushCode(key)
        else fence = []
        continue
      }
      if (fence !== null) { fence.push(value); continue }
      if (!value.trim()) continue
      const image = value.match(/^!\[([^\]]{0,180})\]\(([^)]+)\)$/)
      if (image) {
        result.push(<NotesImage key={key} alt={image[1]}
          assetPath={image[2]} resolveImage={resolveImage} />)
        continue
      }
      const header = value.match(/^(#{1,6})\s+(.+)$/)
      if (header) {
        const level = header[1].length
        result.push(<Typography key={key} variant={level <= 2 ? 'h6' : 'subtitle1'}
          component={('h' + level) as 'h1'}
          sx={{ fontWeight: 700, mt: level <= 2 ? 2 : 1 }}>
          {inlineMarkdown(header[2])}
        </Typography>)
        continue
      }
      if (/^([-*_])\1{2,}\s*$/.test(value)) {
        result.push(<Box key={key} sx={{ borderTop: 1, borderColor: 'divider', my: 1 }} />)
        continue
      }
      if (/^\s*>\s?/.test(value)) {
        result.push(<Box key={key} component="blockquote" sx={{
          borderLeft: 3, borderColor: 'divider', pl: 2, my: 0, color: 'text.secondary',
        }}>{inlineMarkdown(value.replace(/^\s*>\s?/, ''))}</Box>)
        continue
      }
      const bullet = value.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/)
      if (bullet) {
        const numbered = /^\s*\d+\./.test(value)
        if (numbered) ordered++; else ordered = 0
        result.push(<Typography key={key} component="div"
          sx={{ pl: 2 + Math.min(4, bullet[1].length), overflowWrap: 'anywhere' }}>
          {numbered ? String(ordered) + '. ' : '• '}{inlineMarkdown(bullet[2])}
        </Typography>)
        continue
      }
      ordered = 0
      result.push(<Typography key={key} component="p"
        sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {inlineMarkdown(value)}
      </Typography>)
    }
    if (fence !== null) flushCode('last')
    return result
  }, [markdown, resolveImage])
  return <Stack spacing={1.5} data-xdrive-notes-preview sx={{ pb: 4, minWidth: 0 }}>
    {blocks.length ? blocks : <Typography color="text.secondary">空白备忘录</Typography>}
  </Stack>
}
