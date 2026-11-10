import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { MediaTimelineGroupIndex } from '../models'
import { xDriveMediaGalleryTimelineGroupLabel } from './MediaGalleryVirtualTimeline'

type TimeScale = 'all' | 'year' | 'month' | 'day'

/** Presentation-only controls used by full Gallery and signed Places.
 * Each caller retains its authoritative Group Index, Owner scope, load
 * cancellation, Viewer permissions and scroll-to-anchor implementation.
 */
export function XDriveMediaGalleryDateNavigation({
  surface, scale, jumpGroups, dayInput, dayDisabled, currentGroupKey,
  hasReturnAnchor, dayFeedback, onJumpGroup, onJumpDay, onReturn,
}: {
  surface: 'gallery' | 'places'
  scale: TimeScale
  jumpGroups: readonly MediaTimelineGroupIndex[]
  dayInput: string
  dayDisabled: boolean
  currentGroupKey: string | null
  hasReturnAnchor: boolean
  dayFeedback?: string
  onJumpGroup: (group: MediaTimelineGroupIndex) => void
  onJumpDay: (day: string) => void
  onReturn: () => void
}) {
  const gallery = surface === 'gallery'
  const label = scale === 'year' ? '跳转年份' : '跳转年月'

  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap"
      alignItems="center" sx={{minWidth:0,rowGap:0.75}}
      data-xdrive-gallery-date-navigation={gallery ? '' : undefined}
      data-xdrive-places-photo-date-navigation={!gallery ? '' : undefined}>
      {jumpGroups.length > 1 ? (
        <TextField select size="small" value="" label={label}
          aria-label={label}
          data-xdrive-gallery-timeline-jump={gallery ? '' : undefined}
          data-xdrive-places-photo-timeline-jump={!gallery ? '' : undefined}
          onChange={event => {
            const group = jumpGroups.find(candidate => candidate.key === event.target.value)
            if (group) onJumpGroup(group)
          }}
          sx={{minWidth:130,'& .MuiInputBase-root':{minHeight:44},
            '@media (max-width:899.95px)':{
              '& .MuiInputBase-root .MuiSelect-select':{
                minHeight:44,boxSizing:'border-box',display:'flex',alignItems:'center',
              },
            },
          }}>
          <MenuItem value="">{label}</MenuItem>
          {jumpGroups.map(group => (
            <MenuItem key={group.key} value={group.key}>
              {xDriveMediaGalleryTimelineGroupLabel(group.key)}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      {scale === 'day' ? (
        <TextField size="small" type="date" label="跳转日期"
          aria-label="跳转日期"
          data-xdrive-gallery-timeline-day-jump={gallery ? '' : undefined}
          data-xdrive-places-photo-timeline-day-jump={!gallery ? '' : undefined}
          value={dayInput} disabled={dayDisabled}
          onChange={event => onJumpDay(event.target.value)}
          slotProps={{inputLabel:{shrink:true}}}
          sx={{minWidth:160,'& .MuiInputBase-root':{minHeight:44}}}/>
      ) : null}
      {scale !== 'all' ? (
        <Typography variant="caption" color="text.secondary" role="status"
          data-xdrive-gallery-timeline-current-date={gallery ? '' : undefined}
          data-xdrive-places-photo-timeline-current-date={!gallery ? '' : undefined}
          sx={{minHeight:44,display:'inline-flex',alignItems:'center',minWidth:0}}>
          {'当前浏览：' + (currentGroupKey
            ? xDriveMediaGalleryTimelineGroupLabel(currentGroupKey)
            : '尚无可定位日期')}
        </Typography>
      ) : null}
      {hasReturnAnchor ? (
        <Button size="small" variant="outlined" onClick={onReturn}
          data-xdrive-gallery-timeline-return={gallery ? '' : undefined}
          data-xdrive-places-photo-timeline-return={!gallery ? '' : undefined}
          sx={{minHeight:44,textTransform:'none'}}>
          返回刚才位置
        </Button>
      ) : null}
      {dayFeedback ? (
        <Typography variant="caption" color="text.secondary" role="status"
          data-xdrive-places-photo-timeline-day-feedback={!gallery ? '' : undefined}>
          {dayFeedback}
        </Typography>
      ) : null}
    </Stack>
  )
}
