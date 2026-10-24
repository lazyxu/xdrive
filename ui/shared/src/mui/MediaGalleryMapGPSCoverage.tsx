import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { MediaBaiduMapCoverage } from '../models'
import { xDriveBaiduMapCoverageState, xDriveValidBaiduMapCoverage } from '../media-gallery-baidu-coverage'

/** No automatic SDK requests, bulk consent, raw GPS or cross-account count cache. */
export function XDriveMediaGalleryMapGPSCoverage({
  getCoverage, ownerScope = '',
}: {
  getCoverage?: (signal: AbortSignal) => Promise<MediaBaiduMapCoverage>
  ownerScope?: string
}) {
  type View = { owner:string; phase:'idle'|'loading'|'ready'|'error'; data:MediaBaiduMapCoverage|null }
  const [view, setView] = useState<View>({owner:ownerScope,phase:'idle',data:null})
  const serial = useRef(0)
  const inFlight = useRef<AbortController|null>(null)
  const ownerRef = useRef(ownerScope)
  ownerRef.current = ownerScope
  useEffect(() => {
    serial.current++
    inFlight.current?.abort()
    inFlight.current = null
    setView({owner:ownerScope,phase:'idle',data:null})
    return () => { serial.current++; inFlight.current?.abort(); inFlight.current=null }
  }, [ownerScope,getCoverage])
  const current = view.owner === ownerScope ? view : {owner:ownerScope,phase:'idle' as const,data:null}
  const coverageState = current.phase === 'ready' && current.data
    ? xDriveBaiduMapCoverageState(current.data) : 'unverified'
  const load = () => {
    inFlight.current?.abort()
    const request = ++serial.current
    const owner = ownerScope
    const controller = new AbortController()
    inFlight.current = controller
    setView({owner,phase:'loading',data:null})
    if (!getCoverage) {
      setView({owner,phase:'error',data:null})
      return
    }
    void getCoverage(controller.signal).then(result => {
      if (controller.signal.aborted || serial.current !== request || ownerRef.current !== owner) return
      const verified = xDriveValidBaiduMapCoverage(result)
      setView({owner,phase:verified ? 'ready' : 'error',data:verified})
    }).catch(() => {
      if (!controller.signal.aborted && serial.current === request && ownerRef.current === owner) {
        setView({owner,phase:'error',data:null})
      }
    }).finally(() => {
      if (inFlight.current === controller) inFlight.current=null
    })
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
    </Stack>
  </Box>
}
