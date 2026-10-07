import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import type { MediaPlaceFacet } from '../models'
import {
  XDRIVE_MEDIA_PLACES_MAP_MAX_ZOOM,
  XDRIVE_MEDIA_PLACES_MAP_MIN_ZOOM,
  xDriveMediaPlacesClampZoom,
  xDriveMediaPlacesCluster,
  xDriveMediaPlacesFitViewport,
  xDriveMediaPlacesPanViewport,
  xDriveMediaPlacesProject,
} from './MediaGalleryPlacesMapModel'

const WORLD_OUTLINES: Array<Array<[number, number]>> = [
  [
    [-168, 72], [-145, 70], [-130, 58], [-124, 48], [-117, 32],
    [-105, 23], [-96, 18], [-84, 24], [-80, 32], [-66, 46],
    [-58, 54], [-72, 62], [-100, 72], [-132, 74],
  ],
  [
    [-81, 12], [-70, 7], [-61, -5], [-52, -16], [-48, -27],
    [-55, -38], [-67, -55], [-74, -43], [-79, -17],
  ],
  [
    [-10, 72], [20, 72], [55, 68], [90, 72], [125, 60],
    [150, 58], [178, 50], [155, 35], [140, 20], [122, 10],
    [105, 3], [80, 8], [70, 24], [48, 30], [35, 36],
    [20, 45], [8, 44], [-8, 52],
  ],
  [
    [-17, 36], [10, 37], [32, 31], [44, 12], [50, -14],
    [39, -34], [19, -35], [4, -28], [-8, -8], [-17, 15],
  ],
  [
    [112, -11], [132, -10], [153, -25], [146, -39],
    [126, -35], [113, -25],
  ],
  [
    [-55, 82], [-22, 76], [-18, 61], [-40, 58], [-58, 68],
  ],
]

const GRATICULE_LONGITUDES = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]
const GRATICULE_LATITUDES = [-60, -30, 0, 30, 60]

function clusterRadius(itemCount: number) {
  return Math.max(9, Math.min(25, 8 + Math.log2(Math.max(2, itemCount)) * 2))
}

function clusterLabel(itemCount: number) {
  if (itemCount >= 10000) return '10k+'
  if (itemCount >= 1000) return `${Math.floor(itemCount / 1000)}k`
  return String(itemCount)
}

export function XDriveMediaGalleryPlacesMap({
  places,
  activePlaceID,
  onOpenPlace,
}: {
  places: MediaPlaceFacet[]
  activePlaceID?: string
  onOpenPlace?: (place: MediaPlaceFacet) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    x: number
    y: number
    viewport: ReturnType<typeof xDriveMediaPlacesFitViewport>
  } | null>(null)
  const [size, setSize] = useState({ width: 960, height: 360 })
  const fittedViewport = useMemo(
    () => xDriveMediaPlacesFitViewport(places),
    [places],
  )
  const [viewport, setViewport] = useState(fittedViewport)

  useEffect(() => {
    setViewport(fittedViewport)
  }, [
    fittedViewport.centerLatitude,
    fittedViewport.centerLongitude,
    fittedViewport.zoom,
  ])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const width = Math.max(320, host.clientWidth || 960)
      const height = Math.max(260, Math.min(460, Math.round(width * 0.42)))
      setSize((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ))
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    update()
    return () => observer.disconnect()
  }, [])

  const clusters = useMemo(
    () => xDriveMediaPlacesCluster(places, viewport.zoom),
    [places, viewport.zoom],
  )

  const activateCluster = (
    cluster: ReturnType<typeof xDriveMediaPlacesCluster>[number],
  ) => {
    if (cluster.places.length === 1) {
      onOpenPlace?.(cluster.places[0])
      return
    }
    setViewport((current) => ({
      centerLatitude: cluster.latitude,
      centerLongitude: cluster.longitude,
      zoom: xDriveMediaPlacesClampZoom(current.zoom + 2),
    }))
  }

  const handleClusterKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    cluster: ReturnType<typeof xDriveMediaPlacesCluster>[number],
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activateCluster(cluster)
  }

  const startDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      viewport,
    }
  }

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setViewport(xDriveMediaPlacesPanViewport(
      drag.viewport,
      event.clientX - drag.x,
      event.clientY - drag.y,
      size.width,
      size.height,
    ))
  }

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  const zoomBy = (delta: number) => {
    setViewport((current) => ({
      ...current,
      zoom: xDriveMediaPlacesClampZoom(current.zoom + delta),
    }))
  }

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 1 : -1)
  }

  const project = (latitude: number, longitude: number) => (
    xDriveMediaPlacesProject({
      latitude,
      longitude,
      viewport,
      width: size.width,
      height: size.height,
    })
  )

  return (
    <Paper
      ref={hostRef}
      variant="outlined"
      data-xdrive-gallery-places-map
      sx={{ overflow: 'hidden', borderRadius: 2 }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1.5, py: 1 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            地图
          </Typography>
          <Typography variant="caption" color="text.secondary">
            本地 GPS 聚合 · 内置简化地理底图 · 不请求在线地图瓦片
          </Typography>
        </Box>
        <Chip
          size="small"
          label={`${places.length.toLocaleString('zh-CN')} 个地点`}
        />
        <Tooltip title="缩小">
          <span>
            <IconButton
              size="small"
              disabled={viewport.zoom <= XDRIVE_MEDIA_PLACES_MAP_MIN_ZOOM}
              onClick={() => zoomBy(-1)}
              aria-label="缩小地点地图"
            >
              <ZoomOutRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="缩放到所有地点">
          <IconButton
            size="small"
            onClick={() => setViewport(fittedViewport)}
            aria-label="显示所有地点"
          >
            <CenterFocusStrongRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="放大">
          <span>
            <IconButton
              size="small"
              disabled={viewport.zoom >= XDRIVE_MEDIA_PLACES_MAP_MAX_ZOOM}
              onClick={() => zoomBy(1)}
              aria-label="放大地点地图"
            >
              <ZoomInRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box
        component="svg"
        role="group"
        aria-label="照片地点地图"
        viewBox={`0 0 ${size.width} ${size.height}`}
        width="100%"
        height={size.height}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={handleWheel}
        sx={{
          display: 'block',
          touchAction: 'none',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          bgcolor: 'action.hover',
          '& .xdrive-map-grid': {
            stroke: 'divider',
            strokeWidth: 1,
            opacity: 0.65,
          },
          '& .xdrive-map-land': {
            fill: 'background.paper',
            stroke: 'divider',
            strokeWidth: 1.2,
          },
          '& .xdrive-map-cluster': {
            fill: 'primary.main',
            stroke: 'background.paper',
            strokeWidth: 2,
            cursor: 'pointer',
          },
          '& .xdrive-map-cluster-active': {
            fill: 'secondary.main',
          },
          '& .xdrive-map-count': {
            fill: 'primary.contrastText',
            fontSize: 11,
            fontWeight: 700,
            pointerEvents: 'none',
            textAnchor: 'middle',
            dominantBaseline: 'central',
          },
          '& .xdrive-map-cluster-focus:focus-visible circle': {
            stroke: 'text.primary',
            strokeWidth: 3,
          },
        }}
      >
        {GRATICULE_LONGITUDES.map((longitude) => {
          const top = project(90, longitude)
          const bottom = project(-90, longitude)
          return (
            <line
              key={`lon-${longitude}`}
              className="xdrive-map-grid"
              x1={top.x}
              y1={top.y}
              x2={bottom.x}
              y2={bottom.y}
            />
          )
        })}
        {GRATICULE_LATITUDES.map((latitude) => {
          const point = project(latitude, viewport.centerLongitude)
          return (
            <line
              key={`lat-${latitude}`}
              className="xdrive-map-grid"
              x1={0}
              y1={point.y}
              x2={size.width}
              y2={point.y}
            />
          )
        })}
        {WORLD_OUTLINES.map((polygon, polygonIndex) => (
          <polygon
            key={`land-${polygonIndex}`}
            className="xdrive-map-land"
            points={polygon.map(([longitude, latitude]) => {
              const point = project(latitude, longitude)
              return `${point.x},${point.y}`
            }).join(' ')}
          />
        ))}
        {clusters.map((cluster) => {
          const point = project(cluster.latitude, cluster.longitude)
          if (
            point.x < -40 ||
            point.y < -40 ||
            point.x > size.width + 40 ||
            point.y > size.height + 40
          ) return null
          const radius = clusterRadius(cluster.itemCount)
          const singlePlace = cluster.places.length === 1
            ? cluster.places[0]
            : undefined
          const active = Boolean(singlePlace && singlePlace.id === activePlaceID)
          const label = singlePlace
            ? `${singlePlace.name} · ${cluster.itemCount.toLocaleString('zh-CN')} 个项目`
            : `${cluster.places.length.toLocaleString('zh-CN')} 个地点 · ${cluster.itemCount.toLocaleString('zh-CN')} 个项目`
          return (
            <g
              key={cluster.key}
              className="xdrive-map-cluster-focus"
              role="button"
              tabIndex={0}
              aria-label={label}
              transform={`translate(${point.x} ${point.y})`}
              onClick={() => activateCluster(cluster)}
              onKeyDown={(event) => handleClusterKeyDown(event, cluster)}
            >
              <title>{label}</title>
              <circle
                className={active
                  ? 'xdrive-map-cluster xdrive-map-cluster-active'
                  : 'xdrive-map-cluster'}
                r={radius}
              />
              <text className="xdrive-map-count">
                {clusterLabel(cluster.itemCount)}
              </text>
            </g>
          )
        })}
      </Box>
    </Paper>
  )
}
