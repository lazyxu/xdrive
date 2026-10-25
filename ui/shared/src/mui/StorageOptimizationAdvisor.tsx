import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  Typography,
} from '@mui/material'
import type { XDriveAdminStoragePort } from '../admin-management'
import type { StorageOptimizationAdvice } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveTableSurface } from './TableSurface'

const activeStatuses = new Set(['queued', 'running', 'cancel_requested'])
const displayDecision = {
  candidate: '值得进一步测试',
  observe: '继续观测，暂不改动',
  not_recommended: '目前不建议',
} as const

/** Administrator-only, read-only optimization experiment. Uses the existing
 * durable maintenance task, never mutates Blob bytes or format settings. */
export function XDriveStorageOptimizationAdvisor({
  api, onRun, onOpenTaskCenter,
}: {
  api: XDriveAdminStoragePort
  onRun?: () => Promise<void>
  onOpenTaskCenter?: () => void
}) {
  const [advice, setAdvice] = useState<StorageOptimizationAdvice | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [refreshID, setRefreshID] = useState(0)
  const refresh = useCallback(() => setRefreshID((id) => id + 1), [])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setAdvice(null)
    setError('')
    const read = async () => {
      try {
        const current = await api.adminStorageOptimizationAdvice()
        if (!active) return
        setAdvice(current)
        setError('')
        if (activeStatuses.has(current.status)) timer = setTimeout(() => { void read() }, 4000)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : '无法读取压缩与 Pack 测试报告')
      }
    }
    void read()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [api, refreshID])

  const start = async () => {
    if (!onRun || running) return
    setRunning(true)
    setError('')
    try {
      await onRun()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法提交测试任务')
    } finally {
      setRunning(false)
    }
  }

  const report = advice?.report
  const active = advice?.status !== undefined && activeStatuses.has(advice.status)

  return (
    <Stack spacing={1.5} data-xdrive-storage-optimization-advisor>
      <XDriveSectionHeader
        level="h3"
        title="压缩与 Pack 评估"
        subtitle="只读、手动运行的真实 CAS 样本试验。仅提供建议，不改变在线存储、备份格式、压缩算法或打包策略。"
      />
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
        <XDriveActionButton
          disabled={!onRun || running || active}
          onClick={() => { void start() }}
        >
          {active ? '评估任务进行中' : running ? '正在提交…' : '运行压缩与 Pack 测试'}
        </XDriveActionButton>
        <Button size="small" onClick={refresh}>刷新报告</Button>
        {onOpenTaskCenter && <Button size="small" onClick={onOpenTaskCenter}>查看全局任务</Button>}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        取最多 64 个已引用 CAS Blob，每个最多读取前 512 KiB，总读取上限 32 MiB；
        不会执行大目录递归扫描或写回源数据。仅管理员可发起，任务完成后报告保留。
      </Typography>
      {error && <XDriveStatusAlert tone="warning">{error}</XDriveStatusAlert>}
      {!advice && !error && (
        <Typography variant="body2" color="text.secondary">正在读取最新评估记录…</Typography>
      )}
      {advice?.status === 'not_run' && (
        <XDriveStatusAlert tone="neutral">
          尚未运行实际样本评估。历史 CAS-A05/A06 Pack 离线测试不能代替当前实例的测试结果。
        </XDriveStatusAlert>
      )}
      {active && (
        <XDriveStatusAlert tone="neutral">
          当前状态：{advice?.status}。可以离开页面，完成后返回或点击刷新报告。
          {report ? ' 下方显示上一次成功测试的结果。' : ''}
        </XDriveStatusAlert>
      )}
      {advice?.status === 'failed' && (
        <XDriveStatusAlert tone="warning">
          本次评估失败：{advice.error || '请打开全局任务查看错误'}。
          {report ? ' 下方为上一次成功完成的报告。' : ''}
        </XDriveStatusAlert>
      )}
      {report && (
        <Stack spacing={1.5} data-xdrive-storage-optimization-report>
          <Typography variant="body2" color="text.secondary">
            {advice?.generated_at ? `报告时间：${new Date(advice.generated_at).toLocaleString()} · ` : ''}
            已测 {report.sample_objects} 个对象 / {formatBytes(report.sample_bytes)}，
            其中 {report.partial_objects} 个仅取前缀；跳过 {report.skipped_objects} 个异常样本。
            可信度：{report.confidence === 'medium' ? '中（仍仅代表样本）' : '低'}。
          </Typography>
          <XDriveTableSurface>
            <Table size="small" aria-label="CAS 压缩对比">
              <TableHead>
                <TableRow>
                  <TableCell>算法</TableCell>
                  <TableCell align="right">测试字节</TableCell>
                  <TableCell align="right">压缩后字节</TableCell>
                  <TableCell align="right">样本节省率</TableCell>
                  <TableCell align="right">压缩 / 解压</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.compression.map((item) => (
                  <TableRow key={item.algorithm}>
                    <TableCell>{item.algorithm}</TableCell>
                    <TableCell align="right">{formatBytes(item.sample_bytes)}</TableCell>
                    <TableCell align="right">{formatBytes(item.output_bytes)}</TableCell>
                    <TableCell align="right">{item.sample_bytes > 0 ? `${item.savings_percent.toFixed(1)}%` : '—'}</TableCell>
                    <TableCell align="right">{item.compress_ms} / {item.decompress_ms} ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </XDriveTableSurface>
          <Box>
            <Typography variant="body2" fontWeight={600}>小 Blob Pack / Index 模拟</Typography>
            <Typography variant="body2" color="text.secondary">
              {report.pack.objects} 个完整小文件 · 原文件分配空间 {formatBytes(report.pack.source_allocated_bytes)} ·
              Pack+Index 预计 {formatBytes(report.pack.projected_allocated_bytes)} ·
              模型节省 {report.pack.objects > 0 ? `${report.pack.projected_savings_percent.toFixed(1)}%` : '—'}。
            </Typography>
            <Typography variant="caption" color="text.secondary">
              已对内存 Pack 的 SHA、偏移及原字节读回进行测试；物理空间为 4 KiB 块模型，
              并非真实 Pack 落盘、冷读取、在线 GC 或网络速度测试。
            </Typography>
          </Box>
          <Stack spacing={1}>
            {report.recommendations.map((item) => (
              <Box key={item.scope + ':' + item.feature} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  {item.scope === 'online_storage' ? '在线存储' : '备份仓库'} ·
                  {item.feature === 'compression' ? '压缩' : 'Pack'}：
                  {displayDecision[item.decision]}
                </Typography>
                <Typography variant="body2" color="text.secondary">{item.reason}</Typography>
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            不支持以样本节省率推算全实例可释放容量。zstd/LZ4 与真实冷读尚未运行，
            未来同步内容增加后，再对照完整生产负载决定存储层或备份层是否值得启用。
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}
