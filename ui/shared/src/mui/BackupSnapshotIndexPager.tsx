import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material'
import type {
  XDriveServerBackupSnapshotIndexPage, XDriveServerBackupSnapshotIndexQuery,
} from '../server-backup-admin'

const pageSize = 50
const firstOlderOffset = 100
const validIdentity = /^(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$/

/** Older Host identities are not verified backups and are intentionally not
 * selectable for restore, deletion or other destructive actions. */
export function XDriveBackupSnapshotIndexPager({
  readPage, policyRevision,
}: {
  readPage: (query: XDriveServerBackupSnapshotIndexQuery) => Promise<XDriveServerBackupSnapshotIndexPage>
  policyRevision: string
}) {
  const generation = useRef(0)
  const [result, setResult] = useState<XDriveServerBackupSnapshotIndexPage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    generation.current += 1
    setResult(null)
    setError('')
    setLoading(false)
    return () => { generation.current += 1 }
  }, [readPage, policyRevision])

  const load = useCallback(async (offset: number) => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    try {
      const incoming = await readPage({ offset, limit: pageSize })
      if (request !== generation.current) return
      const ids = incoming.snapshot_ids
      if (incoming.protocol !== 'xdrive-backup-snapshot-page-v1' ||
          incoming.scope !== 'unverified_identity_only' ||
          !Number.isSafeInteger(incoming.total_snapshots) ||
          !Number.isSafeInteger(incoming.indexed_snapshots) ||
          incoming.total_snapshots < 0 || incoming.total_snapshots > 1000000 ||
          incoming.indexed_snapshots < 0 || incoming.indexed_snapshots > 1000 ||
          incoming.indexed_snapshots > incoming.total_snapshots ||
          incoming.truncated !== (incoming.indexed_snapshots < incoming.total_snapshots) ||
          incoming.offset !== offset || incoming.limit !== pageSize ||
          !Array.isArray(ids) || ids.length > pageSize ||
          ids.some(id => typeof id !== 'string' || !validIdentity.test(id)) ||
          new Set(ids).size !== ids.length ||
          (incoming.next_offset !== undefined &&
            (!Number.isSafeInteger(incoming.next_offset) ||
              incoming.next_offset <= offset || incoming.next_offset > 1000))) {
        throw new Error('宿主机返回的备份索引页不符合安全协议。')
      }
      setResult(incoming)
    } catch (e) {
      if (request === generation.current) {
        setResult(null)
        setError(e instanceof Error ? e.message : '无法读取较早的备份索引。')
      }
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [readPage])

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}
      data-xdrive-admin-backup-older-snapshots>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>较早备份快照 · 只读索引</Typography>
        <Typography variant="body2" color="text.secondary">
          这里显示最新 100 代之后的规范快照编号，不表示文件完整、通过 SHA-256 校验或可恢复。
          旧代不能从此列表直接恢复或删除，需后续由宿主机重新验证。
        </Typography>
        {!result ? (
          <Button variant="outlined" disabled={loading}
            onClick={() => { void load(firstOlderOffset) }}>
            {loading ? '读取较早快照中…' : '查看第 101 代及更早快照'}
          </Button>
        ) : (
          <>
            <Typography variant="caption">
              共发现 {result.total_snapshots.toLocaleString('zh-CN')} 代；
              当前索引覆盖 {result.indexed_snapshots.toLocaleString('zh-CN')} 代。
              本页从第 {result.offset + 1} 代开始。
            </Typography>
            <TableContainer sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader aria-label="较早备份快照只读列表">
                <TableHead>
                  <TableRow><TableCell>序号</TableCell><TableCell>宿主机规范快照编号</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {result.snapshot_ids.map((id, i) => (
                    <TableRow key={id}>
                      <TableCell>{result.offset + i + 1}</TableCell>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{id}</TableCell>
                    </TableRow>
                  ))}
                  {!result.snapshot_ids.length ? (
                    <TableRow><TableCell colSpan={2}>此索引范围没有其他快照。</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button disabled={loading || result.offset <= firstOlderOffset}
                onClick={() => { void load(Math.max(firstOlderOffset, result.offset - pageSize)) }}>
                上一页
              </Button>
              <Button disabled={loading || result.next_offset === undefined}
                onClick={() => { if (result.next_offset !== undefined) void load(result.next_offset) }}>
                下一页
              </Button>
              <Button disabled={loading} onClick={() => { void load(result.offset) }}>
                刷新本页
              </Button>
            </Stack>
            {result.truncated ? (
              <Alert severity="warning">
                宿主机最多提供 1,000 个快照编号；实际总数更多。
                达到索引上限后不可据此推断已经读完全部备份。
              </Alert>
            ) : null}
          </>
        )}
        {error ? <Alert severity="warning" role="alert">{error}</Alert> : null}
      </Stack>
    </Paper>
  )
}
