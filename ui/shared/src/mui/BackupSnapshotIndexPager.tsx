import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material'
import type {
  XDriveServerBackupSnapshotIndexPage, XDriveServerBackupSnapshotIndexQuery,
  XDriveServerBackupPage,
} from '../server-backup-admin'
import { serverBackupHistoricalVerificationLabel } from '../server-backup-integrity'

const pageSize = 50
const firstOlderOffset = 100
const validIdentity = /^(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$/

/** Older identities are not proof of a restorable generation. A bounded
 * verification-only action is allowed after fresh Server/Host index fencing;
 * restore, deletion and drill must remain unavailable here. */
export function XDriveBackupSnapshotIndexPager({
  readPage, policyRevision, history, verifyMode, actionsDisabled, onVerifyOlderSnapshot,
}: {
  readPage: (query: XDriveServerBackupSnapshotIndexQuery) => Promise<XDriveServerBackupSnapshotIndexPage>
  policyRevision: string
  history: XDriveServerBackupPage['history']
  verifyMode: 'fast' | 'deep'
  actionsDisabled: boolean
  onVerifyOlderSnapshot: (snapshotID: string) => void
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
          incoming.indexed_snapshots < 0 || incoming.indexed_snapshots > 10000 ||
          incoming.indexed_snapshots > incoming.total_snapshots ||
          incoming.truncated !== (incoming.indexed_snapshots < incoming.total_snapshots) ||
          incoming.offset !== offset || incoming.limit !== pageSize ||
          !Array.isArray(ids) || ids.length > pageSize ||
          ids.some(id => typeof id !== 'string' || !validIdentity.test(id)) ||
          new Set(ids).size !== ids.length ||
          (incoming.next_offset !== undefined &&
            (!Number.isSafeInteger(incoming.next_offset) ||
              incoming.next_offset <= offset || incoming.next_offset > 10000))) {
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
          旧代仅能请求只读完整性校验；不能从此列表直接恢复或删除，也不能执行演练。
          校验时 Server 会重新核对当前 Host 索引，Host 再次核对真实快照；历史结果不代表当前可恢复。
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
                  <TableRow><TableCell>序号</TableCell><TableCell>宿主机规范快照编号</TableCell><TableCell>最近验证（历史）</TableCell><TableCell>只读校验</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {result.snapshot_ids.map((id, i) => (
                    <TableRow key={id}>
                      <TableCell>{result.offset + i + 1}</TableCell>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{id}</TableCell>
                      <TableCell data-xdrive-admin-older-verification-history>
                        {serverBackupHistoricalVerificationLabel(history, id)}
                      </TableCell>
                      <TableCell>
                        <Button size="small" variant="outlined"
                          disabled={loading || actionsDisabled}
                          aria-label={`验证较早备份 ${id}`}
                          data-xdrive-admin-older-backup-verify
                          onClick={() => onVerifyOlderSnapshot(id)}>
                          验证（{verifyMode}）
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!result.snapshot_ids.length ? (
                    <TableRow><TableCell colSpan={4}>此索引范围没有其他快照。</TableCell></TableRow>
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
                当前宿主机只索引了 {result.indexed_snapshots.toLocaleString('zh-CN')} / {result.total_snapshots.toLocaleString('zh-CN')} 代；超过已索引范围的备份仍不能从此页读取或验证。新版 Host 最多索引 10,000 代，旧版最多 1,000 代。
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
