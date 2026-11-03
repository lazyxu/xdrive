import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider,
  List, ListItemButton, Stack, Typography,
} from '@mui/material'

export interface XDriveSyncRunCursor {
  /** Decimal nanoseconds as a string: JavaScript Number cannot safely hold UnixNano. */
  before_started_at: string
  before_run_id: string
}
export interface XDriveSyncItemCursor {
  before_applied_at: string
  before_item_id: string
}
export interface XDriveSyncActivityPage<T, Cursor> {
  items: T[]
  next_cursor: Cursor | null
}
export interface XDriveSyncActivityStats {
  items: number
  successful: number
  created: number
  updated: number
  deleted: number
  moved: number
  renamed: number
  uploaded: number
  downloaded: number
  skipped: number
  failed: number
  conflicted: number
  transferred_bytes: number | null
}
export interface XDriveSyncRun {
  run_id: string
  engine_kind: string
  trigger: string
  started_at: string
  finished_at: string | null
  status: string
  outcome: string
  detail_complete: boolean
  details_expired: boolean
  stats: XDriveSyncActivityStats
}
export interface XDriveSyncItem {
  run_id: string
  item_id: string
  action: string
  direction: string
  status: string
  old_path: string
  new_path: string
  logical_bytes: number | null
  transferred_bytes: number | null
  error_code: string
  error_message: string
  applied_at: string
}
export interface XDriveSyncActivityDataSource {
  runs(limit: number, cursor?: XDriveSyncRunCursor): Promise<
    XDriveSyncActivityPage<XDriveSyncRun, XDriveSyncRunCursor>>
  run(id: string): Promise<XDriveSyncRun>
  items(id: string, limit: number, cursor?: XDriveSyncItemCursor): Promise<
    XDriveSyncActivityPage<XDriveSyncItem, XDriveSyncItemCursor>>
}

const PAGE_SIZE = 20
const ITEM_PAGE_SIZE = 50
const actionLabels: Record<string, string> = {
  create: '新增', update: '更新', delete: '删除', move: '移动',
  rename: '重命名', noop: '检查',
}
const statusLabels: Record<string, string> = {
  running: '同步中', completed: '已完成', partial: '部分完成',
  failed: '失败', cancelled: '已取消', interrupted: '中断',
}
const directionLabels: Record<string, string> = {
  upload: '上传', download: '下载', local: '本地元数据', none: '无数据传输',
}
const triggerLabels: Record<string, string> = {
  initial: '初次检查', local: '本地变更', manual: '手动同步',
  remote: '远端更新', audit: '完整检查', retry: '重试',
}
function dateLabel(value: string | null) {
  if (!value) return '尚未完成'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString()
}
function bytesLabel(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return '未采集'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}
function summaryText(run: XDriveSyncRun) {
  const stats = run.stats
  const counts = [
    ['新增', stats.created], ['更新', stats.updated], ['移动', stats.moved],
    ['重命名', stats.renamed], ['删除', stats.deleted], ['失败', stats.failed],
    ['冲突', stats.conflicted],
  ].filter(([, count]) => typeof count === 'number' && count > 0)
  return counts.length > 0 ? counts.map(([label, count]) => `${label} ${count}`).join(' · ')
    : run.detail_complete ? '本次没有需要同步的变更' : '本次尚无已记录的逐项变更'
}

function XDriveSyncRunDetail({ source, runID }: {
  source: XDriveSyncActivityDataSource
  runID: string
}) {
  const [run, setRun] = useState<XDriveSyncRun | null>(null)
  const [items, setItems] = useState<XDriveSyncItem[]>([])
  const [cursors, setCursors] = useState<Array<XDriveSyncItemCursor | null>>([null])
  const [next, setNext] = useState<XDriveSyncItemCursor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const cursor = cursors[cursors.length - 1] ?? undefined

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(false)
    void Promise.all([
      source.run(runID),
      source.items(runID, ITEM_PAGE_SIZE, cursor),
    ]).then(([value, page]) => {
      if (!current) return
      setRun(value)
      setItems(page.items)
      setNext(page.next_cursor)
    }).catch(() => {
      if (!current) return
      setError(true)
      setRun(null)
      setItems([])
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [source, runID, cursor, retry])

  return (
    <Stack spacing={1.5} sx={{ p: 2 }} data-xdrive-sync-run-detail={runID}>
      {loading ? <CircularProgress size={22} aria-label="正在读取同步明细" /> : null}
      {error ? (
        <Alert severity="error" action={<Button size="small" onClick={() => setRetry(n => n + 1)}>重试</Button>}>
          读取本次同步记录失败，不能将失败解释为无变化。
        </Alert>
      ) : null}
      {run ? (
        <>
          <Typography variant="body2">
            {triggerLabels[run.trigger] ?? run.trigger} ·
            {dateLabel(run.started_at)} — {dateLabel(run.finished_at)}
          </Typography>
          <Typography variant="body2">{summaryText(run)}</Typography>
          <Typography variant="caption" color="text.secondary">
            文件变更与传输方向分开统计：上传 {run.stats.uploaded} · 下载 {run.stats.downloaded} ·
            实际传输 {bytesLabel(run.stats.transferred_bytes)}
          </Typography>
          {!run.detail_complete ? (
            <Alert severity="info">
              当前同步版本只采集了部分操作类型。未记录的文件不代表没有变化，也不能把已记录数量当成本轮总数。
            </Alert>
          ) : null}
          {run.details_expired ? (
            <Alert severity="info">部分逐项明细已到保留期；上述历史汇总仍保留。</Alert>
          ) : null}
          {items.length === 0 && !loading ? (
            <Typography variant="body2" color="text.secondary">
              {run.detail_complete && run.outcome === 'no_change' ? '本次没有文件变更。' : '当前页没有可展示的逐项记录。'}
            </Typography>
          ) : null}
          <List dense disablePadding>
            {items.map(item => (
              <Box key={item.item_id} component="li" sx={{ listStyle: 'none', py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                <Stack direction="row" justifyContent="space-between" gap={1} alignItems="center">
                  <Typography variant="body2" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>
                    {item.old_path && item.old_path !== item.new_path
                      ? `${item.old_path} → ${item.new_path || '已删除'}`
                      : item.new_path || item.old_path || '路径未提供'}
                  </Typography>
                  <Chip size="small" label={item.status === 'conflict' ? '冲突' :
                    item.status === 'failed' ? '失败' : actionLabels[item.action] ?? item.action} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {directionLabels[item.direction] ?? item.direction} ·
                  {dateLabel(item.applied_at)}
                  {item.transferred_bytes === null ? ' · 网络字节未采集' :
                    ` · ${bytesLabel(item.transferred_bytes)}`}
                </Typography>
                {item.error_code || item.error_message ? (
                  <Typography variant="caption" color="error" display="block">
                    {item.error_code}{item.error_message ? ` · ${item.error_message}` : ''}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </List>
          <Stack direction="row" spacing={1}>
            <Button size="small" disabled={loading || cursors.length === 1}
              onClick={() => setCursors(current => current.slice(0, -1))}>上一页</Button>
            <Button size="small" disabled={loading || !next}
              onClick={() => { if (next) setCursors(current => [...current, next]) }}>下一页</Button>
          </Stack>
        </>
      ) : null}
    </Stack>
  )
}

/** Optional Owner-scoped Windows Agent read surface, shared with DSM layout. */
export function XDriveSyncActivityPanel({
  source, sessionKey, focusedRunID,
}: {
  source: XDriveSyncActivityDataSource
  sessionKey: string
  focusedRunID?: string
}) {
  const [runs, setRuns] = useState<XDriveSyncRun[]>([])
  const [cursors, setCursors] = useState<Array<XDriveSyncRunCursor | null>>([null])
  const [next, setNext] = useState<XDriveSyncRunCursor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<string | null>(focusedRunID ?? null)
  const cursor = cursors[cursors.length - 1] ?? undefined

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(false)
    void source.runs(PAGE_SIZE, cursor).then(page => {
      if (!current) return
      setRuns(page.items)
      setNext(page.next_cursor)
    }).catch(() => {
      if (!current) return
      setError(true)
      setRuns([])
      setNext(null)
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [source, sessionKey, cursor, refresh])

  return (
    <Stack spacing={1.25} data-xdrive-sync-activity={sessionKey}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">仅记录当前 Windows 设备、当前账号的本机同步。</Typography>
        <Button size="small" onClick={() => {
          setCursors([null])
          setRefresh(n => n + 1)
        }}>刷新</Button>
      </Stack>
      {loading ? <CircularProgress size={22} aria-label="正在读取同步历史" /> : null}
      {error ? <Alert severity="error">同步历史读取失败；请检查 Agent 连接后刷新。</Alert> : null}
      {!loading && !error && runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          当前页暂无记录；旧版本同步不会补造历史。
        </Typography>
      ) : null}
      <List disablePadding>
        {runs.map(run => (
          <Box key={run.run_id} component="li" sx={{ listStyle: 'none' }}>
            <ListItemButton selected={selected === run.run_id} onClick={() =>
              setSelected(current => current === run.run_id ? null : run.run_id)}
              data-xdrive-sync-run-id={run.run_id}
              sx={{ borderRadius: 1 }}>
              <Stack spacing={0.35} sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" fontWeight={600}>{dateLabel(run.started_at)}</Typography>
                  <Chip size="small" label={statusLabels[run.status] ?? run.status} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {triggerLabels[run.trigger] ?? run.trigger} · {summaryText(run)}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">查看</Typography>
            </ListItemButton>
            {selected === run.run_id ? <XDriveSyncRunDetail key={run.run_id} source={source} runID={run.run_id} /> : null}
            <Divider />
          </Box>
        ))}
      </List>
      {selected && !runs.some(run => run.run_id === selected) ? (
        <XDriveSyncRunDetail key={selected} source={source} runID={selected} />
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button size="small" disabled={loading || cursors.length === 1}
          onClick={() => setCursors(current => current.slice(0, -1))}>上一页</Button>
        <Button size="small" disabled={loading || !next}
          onClick={() => { if (next) setCursors(current => [...current, next]) }}>下一页</Button>
      </Stack>
    </Stack>
  )
}
