import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Typography,
} from '@mui/material'
import type {
  XDriveAdminStoragePort, XDriveStorageVerificationRunPage,
} from '../admin-management'
import {
  xDriveAppendStorageVerificationHistory,
  xDriveNormalizeStorageVerificationHistory,
} from '../storage-verification-history'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveTableSurface } from './TableSurface'

const pageLimit = 20
const stateText: Record<string, string> = {
  success: '检查完成，未报告问题', issues: '发现一致性问题',
  failed: '任务失败', partial: '部分完成',
  cancelled: '已取消',
}
function localTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '未知'
}

/** Read-only admin verification history. Bound to the current authenticated
 * storage port; route and Server auth remain authoritative. */
export function XDriveStorageVerificationHistoryPanel({ api }: {
  api: XDriveAdminStoragePort
}) {
  const generation = useRef(0)
  const [snapshot, setSnapshot] = useState<{
    api: XDriveAdminStoragePort
    page: XDriveStorageVerificationRunPage
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const page = snapshot?.api === api ? snapshot.page : null

  const refresh = useCallback(() => {
    const ticket = ++generation.current
    setLoading(true)
    setError('')
    void api.adminStorageVerificationRuns(pageLimit).then(raw => {
      if (ticket !== generation.current) return
      const next = xDriveNormalizeStorageVerificationHistory(raw)
      if (!next) throw new Error('invalid_history_envelope')
      setSnapshot({ api, page: next })
    }).catch(() => {
      if (ticket !== generation.current) return
      setSnapshot(null)
      setError('无法取得当前管理员的可信历史校验记录；可能需要更新 Server 或 Agent。')
    }).finally(() => {
      if (ticket === generation.current) setLoading(false)
    })
  }, [api])

  useEffect(() => {
    setSnapshot(null)
    setError('')
    setLoadingMore(false)
    refresh()
    return () => { generation.current += 1 }
  }, [refresh])

  const loadMore = () => {
    if (!page?.next_cursor || loading || loadingMore) return
    const ticket = ++generation.current
    const expected = page.next_cursor
    setLoadingMore(true)
    setError('')
    void api.adminStorageVerificationRuns(pageLimit, expected).then(raw => {
      if (ticket !== generation.current) return
      const next = xDriveNormalizeStorageVerificationHistory(raw)
      const combined = next && xDriveAppendStorageVerificationHistory(page, next)
      if (!combined) throw new Error('invalid_history_page')
      setSnapshot({ api, page: combined })
    }).catch(() => {
      if (ticket === generation.current)
        setError('继续加载历史校验记录失败，原有记录已保留，请重试。')
    }).finally(() => {
      if (ticket === generation.current) setLoadingMore(false)
    })
  }

  return (
    <Box data-xdrive-admin-storage-verification-history>
      <Stack spacing={1.5}>
        <XDriveSectionHeader level="h3" title="在线存储完整性校验历史"
          subtitle="仅显示实际完成的历史维护任务；并非实时完整性状态，也不是备份仓库恢复验证。"
          actions={<Button size="small" variant="outlined" disabled={loading || loadingMore}
            onClick={refresh}>刷新历史</Button>} />
        {error ? <Typography variant="body2" color="error" role="alert">{error}</Typography> : null}
        {!page && loading ? (
          <Typography variant="body2" color="text.secondary">正在读取已授权的历史记录…</Typography>
        ) : null}
        {page && page.items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">当前没有已完成的存储完整性校验记录。</Typography>
        ) : null}
        {page && page.items.length > 0 ? (
          <XDriveTableSurface>
            <Table size="small" aria-label="在线存储完整性校验历史">
              <TableHead>
                <TableRow>
                  <TableCell>任务编号</TableCell>
                  <TableCell>验证级别</TableCell>
                  <TableCell>结果</TableCell>
                  <TableCell>开始时间</TableCell>
                  <TableCell>完成时间</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {page.items.map(item => (
                  <TableRow key={item.run_id}>
                    <TableCell>{item.run_id}</TableCell>
                    <TableCell>{item.mode === 'fast' ? 'fast · 元数据/可读性' : 'deep · SHA-256'}</TableCell>
                    <TableCell>{stateText[item.state] || '未知状态'}</TableCell>
                    <TableCell>{localTime(item.started_at)}</TableCell>
                    <TableCell>{localTime(item.finished_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </XDriveTableSurface>
        ) : null}
        {page?.next_cursor ? (
          <Button size="small" variant="outlined" disabled={loadingMore || loading}
            onClick={loadMore}>{loadingMore ? '正在加载…' : '加载更早记录'}</Button>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          按固定游标逐页读取持久化历史记录，每次最多 20 条；系统通常保留 90 天，
          但每种维护任务的最后一条记录可能超过 90 天，不能将缺失历史解释为从未校验。
          未产生结构化报告的旧任务仅显示模式、状态和时间；不得把历史成功推断为当前内容完整。
          fast 不会发现同大小的内容损坏，deep 也不等于文件与 PostgreSQL 恢复演练。
        </Typography>
      </Stack>
    </Box>
  )
}
