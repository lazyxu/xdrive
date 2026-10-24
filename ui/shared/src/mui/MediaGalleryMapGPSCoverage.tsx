import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { MediaBaiduMapCoverage, MediaBaiduMapCoverageReasons } from '../models'
import { xDriveBaiduMapCoverageState, xDriveValidBaiduMapCoverage, xDriveValidBaiduMapCoverageReasons, xDriveBaiduMapCoverageReasonTotalsMatch } from '../media-gallery-baidu-coverage'

/** No automatic SDK requests, bulk consent, raw GPS or cross-account count cache. */
export function XDriveMediaGalleryMapGPSCoverage({
  getCoverage, getReasons, ownerScope = '',
}: {
  getCoverage?: (signal: AbortSignal) => Promise<MediaBaiduMapCoverage>
  getReasons?: (signal: AbortSignal) => Promise<MediaBaiduMapCoverageReasons>
  ownerScope?: string
}) {
  type ReasonPhase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'changed'
  type View = {
    owner:string
    phase:'idle'|'loading'|'ready'|'error'
    data:MediaBaiduMapCoverage|null
    reasons:MediaBaiduMapCoverageReasons|null
    reasonPhase:ReasonPhase
  }
  const emptyView = (owner:string):View => ({
    owner,phase:'idle',data:null,reasons:null,reasonPhase:'idle',
  })
  const [view, setView] = useState<View>(emptyView(ownerScope))
  const serial = useRef(0)
  const inFlight = useRef<AbortController|null>(null)
  const ownerRef = useRef(ownerScope)
  ownerRef.current = ownerScope
  useEffect(() => {
    serial.current++
    inFlight.current?.abort()
    inFlight.current = null
    setView(emptyView(ownerScope))
    return () => { serial.current++; inFlight.current?.abort(); inFlight.current=null }
  }, [ownerScope,getCoverage,getReasons])
  const current = view.owner === ownerScope ? view : emptyView(ownerScope)
  const coverageState = current.phase === 'ready' && current.data
    ? xDriveBaiduMapCoverageState(current.data) : 'unverified'
  const load = () => {
    inFlight.current?.abort()
    const request = ++serial.current
    const owner = ownerScope
    const controller = new AbortController()
    inFlight.current = controller
    setView({...emptyView(owner),phase:'loading'})
    if (!getCoverage) {
      setView({...emptyView(owner),phase:'error'})
      inFlight.current = null
      return
    }
    const apply = (fn:(previous:View)=>View) => {
      if (controller.signal.aborted || serial.current !== request || ownerRef.current !== owner) return
      setView(previous => previous.owner === owner ? fn(previous) : previous)
    }
    void (async () => {
      try {
        const coverage = xDriveValidBaiduMapCoverage(await getCoverage(controller.signal))
        if (!coverage) throw new Error('invalid_coverage')
        // Most users should not pay a second potentially 100k-row SQL
        // aggregation when every indexed GPS PhotoAsset is already visible.
        const needReasons = Boolean(getReasons && coverage.not_eligible_bd09_assets > 0)
        apply(previous => ({
          ...previous,phase:'ready',data:coverage,
          reasons:null,reasonPhase:needReasons ? 'loading' : 'unavailable',
        }))
        if (!needReasons || !getReasons) return
        try {
          const reasons = xDriveValidBaiduMapCoverageReasons(await getReasons(controller.signal))
          // Two independent SQL snapshots can differ. Reject count drift;
          // matching counts alone do not establish identical member IDs.
          const sameTotals = xDriveBaiduMapCoverageReasonTotalsMatch(coverage, reasons)
          apply(previous => ({
            ...previous, reasons:sameTotals ? reasons : null,
            reasonPhase:!reasons ? 'unavailable' : sameTotals ? 'ready' : 'changed',
          }))
        } catch {
          apply(previous => ({...previous,reasons:null,reasonPhase:'unavailable'}))
        }
      } catch {
        apply(previous => ({...previous,phase:'error',data:null,reasons:null,reasonPhase:'idle'}))
      } finally {
        if (inFlight.current === controller) inFlight.current=null
      }
    })()
  }
  return <Box component="details" data-xdrive-map-gps-coverage
    sx={{mt:1,borderTop:1,borderColor:'divider',pt:0.75}}>
    <Box component="summary" sx={{cursor:'pointer',typography:'caption',
      color:'text.secondary',minHeight:32}}>全图库 GPS 覆盖核对</Box>
    <Stack spacing={0.75} sx={{mt:0.75}}>
      <Typography variant="caption" color="text.secondary">
        仅统计当前账户已索引完成的 PhotoAsset，不代表全部磁盘照片，不触发百度转换。
      </Typography>
      <Box><Button size="small" variant="outlined" disabled={current.phase==='loading'}
        onClick={load} data-xdrive-map-gps-coverage-refresh>
        {current.phase==='ready' ? '重新核对' : '核对 GPS 覆盖'}
      </Button></Box>
      {current.phase==='loading' ? <Stack direction="row" spacing={1} alignItems="center" role="status">
        <CircularProgress size={16}/><Typography variant="caption">正在查询 GPS 覆盖…</Typography>
      </Stack> : null}
      {current.phase==='error' ? <Typography role="alert" variant="caption" color="text.secondary"
        data-xdrive-map-gps-coverage-unavailable>
        统计暂不可用（可能是旧 Server、网络或查询失败），不代表 0 张照片。
      </Typography> : null}
      {current.phase==='ready' && current.data ? <Box data-xdrive-map-gps-coverage-counts>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Typography variant="caption">有效原始 GPS：{current.data.valid_gps_assets.toLocaleString('zh-CN')} 张</Typography>
          <Typography variant="caption">当前 BD-09 可显示：{current.data.eligible_bd09_assets.toLocaleString('zh-CN')} 张</Typography>
          <Typography variant="caption">尚不可显示：{current.data.not_eligible_bd09_assets.toLocaleString('zh-CN')} 张</Typography>
        </Stack>
        <Typography variant="caption" role="status" color="text.secondary"
          data-xdrive-map-gps-coverage-explanation sx={{display:'block',mt:0.75}}>
          {coverageState === 'no-valid-gps'
            ? '当前已完成索引的照片没有有效原始 GPS；不代表磁盘上其他照片没有定位信息。'
            : coverageState === 'none-displayable'
              ? '已有有效原始 GPS，但目前没有符合授权、来源修订和 BD-09 派生索引要求的可显示照片。不会自动向百度发送这些坐标。'
              : coverageState === 'partial'
                ? '只有部分有效 GPS 照片可在 BD-09 地图显示；差额可能来自授权、来源更新或派生索引状态，不能直接认定为 GPS 错误。'
                : '在本次已完成索引的统计范围内，全部有效 GPS 均具备 BD-09 显示资格；这不代表百度动态地图已运行成功。'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:0.5}}>
          来源纬度超出当前地图范围：{current.data.source_outside_camera_latitude_assets.toLocaleString('zh-CN')} 张。
          差额可能来自授权、来源修订或派生索引；不等于 GPS 错误，也不证明动态地图已启用。
        </Typography>
      </Box> : null}
      {current.phase === 'ready' && current.data &&
          current.data.not_eligible_bd09_assets > 0 ? (
        <Box data-xdrive-map-gps-coverage-reasons sx={{mt:0.75}}>
          {current.reasonPhase === 'loading' ? (
            <Typography variant="caption" role="status" color="text.secondary">
              正在核对不可显示照片的原因…
            </Typography>
          ) : current.reasonPhase === 'ready' && current.reasons ? (
            <>
              <Typography variant="caption" sx={{fontWeight:700}}>
                当前不可显示原因（互斥统计）
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:0.5}}>
                两次独立查询的数量已匹配；若期间有照片或授权变更，请重新核对。
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{mt:0.5}}>
                <Typography variant="caption">授权未生效或已撤销：{current.reasons.consent_unavailable_assets.toLocaleString('zh-CN')} 张</Typography>
                <Typography variant="caption">授权来源已改变：{current.reasons.consent_source_changed_assets.toLocaleString('zh-CN')} 张</Typography>
                <Typography variant="caption">尚无派生位置：{current.reasons.derived_missing_assets.toLocaleString('zh-CN')} 张</Typography>
                <Typography variant="caption">派生位置不可用：{current.reasons.derived_invalid_assets.toLocaleString('zh-CN')} 张</Typography>
              </Stack>
            </>
          ) : current.reasonPhase === 'changed' ? (
            <Typography role="status" variant="caption" color="text.secondary">
              查询期间照片或授权数量已变化，请重新核对；不会混合两个快照显示原因。
            </Typography>
          ) : (
            <Typography role="status" variant="caption" color="text.secondary">
              原因明细暂不可用（可能是旧 Server 或 Agent）；不代表这些分类都是 0 张。
            </Typography>
          )}
        </Box>
      ) : null}
    </Stack>
  </Box>
}
