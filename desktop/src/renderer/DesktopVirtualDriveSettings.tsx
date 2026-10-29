import type { FormEvent } from 'react'
import {
  Box as MuiBox, Divider, InputAdornment, Stack, TextField, Typography,
} from '@mui/material'
import { XDriveActionButton } from '@xdrive/ui/mui'
import { formatBytes } from '@xdrive/shared'

/**
 * Desktop-only mount and cache feature UI. This is NOT ordinary local-folder
 * Push backup. Real mount/CfAPI/FUSE and policy operations stay in the
 * authenticated owning Agent through the Desktop Host callbacks.
 */
export type DesktopVirtualDriveSettingsProps = {
  settings: AgentSettings
  mountPath: string
  cacheLimit: string
  platform?: string
  storagePoliciesSupported: boolean
  busy: string
  onMountPathChange: (value: string) => void
  onCacheLimitChange: (value: string) => void
  onChooseMountPath: () => void
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => void
  onOpenStorage: () => void
}

export function DesktopVirtualDriveSettings({
  settings, mountPath, cacheLimit, platform, storagePoliciesSupported, busy,
  onMountPathChange, onCacheLimitChange, onChooseMountPath, onSaveSettings, onOpenStorage,
}: DesktopVirtualDriveSettingsProps) {
  return (
        <MuiBox component="form" onSubmit={onSaveSettings} sx={{ maxWidth: 720, mt: 2 }}>
          <Stack spacing={2}>
            <Stack spacing={0.75}>
              <Typography variant="body2" fontWeight={700} color="text.secondary">
                云盘挂载路径（本机）
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ xs: 'stretch', sm: 'center' }}
              >
                <TextField
                  fullWidth
                  size="small"
                  value={mountPath}
                  onChange={(event) => onMountPathChange(event.target.value)}
                  required
                />
                <XDriveActionButton onClick={onChooseMountPath}>浏览</XDriveActionButton>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                这里配置 Windows CfAPI / Linux FUSE 云盘在本机的入口；不是「设备备份」中的普通本地来源目录。
              </Typography>
            </Stack>

            <Stack spacing={0.75}>
              <Typography variant="body2" fontWeight={700} color="text.secondary">
                缓存上限
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={cacheLimit}
                onChange={(event) => onCacheLimitChange(event.target.value)}
                disabled={platform !== 'win32'}
                required
                slotProps={{
                  htmlInput: {
                    min: 0,
                    max: 16384,
                    step: 0.25,
                  },
                  input: {
                    endAdornment: <InputAdornment position="end">GiB</InputAdornment>,
                  },
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {platform === 'win32'
                  ? `0 表示不限；新设备默认 20 GiB。当前值：${formatBytes(settings.cache_limit_bytes)}。已固定 / 始终保留的内容不会被清理。`
                  : '持久化下载缓存上限适用于 Windows CfAPI；Linux FUSE 对每次打开使用临时文件。'}
              </Typography>
            </Stack>

            <Divider />

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2.25}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="space-between"
            >
              <MuiBox sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
                <Typography variant="body2" fontWeight={700} color="text.secondary">
                  {storagePoliciesSupported ? '文件夹存储策略' : platform === 'linux' ? 'Linux FUSE 存储模式' : '云盘存储策略'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                  {storagePoliciesSupported
                    ? '可在“本地存储”页面的文件夹策略中选择“默认”“不同步”或“始终保留”。'
                    : platform === 'linux'
                      ? 'Linux 使用 FUSE 远程挂载；“本地存储”页面提供只读目录视图，不提供 Windows CfAPI 的选择性同步和固定保留。'
                      : '当前平台没有已验证的 CfAPI/FUSE 文件夹存储策略，请以实际 Agent 能力为准。'}
                </Typography>
              </MuiBox>
              <XDriveActionButton onClick={onOpenStorage}>
                {storagePoliciesSupported ? '管理本地存储' : '查看本地存储'}
              </XDriveActionButton>
            </Stack>

            <Divider />

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <XDriveActionButton
                intent="primary"
                type="submit"
                loading={busy === 'settings'}
                loadingLabel="正在保存…"
              >
                保存设置
              </XDriveActionButton>
            </Stack>
          </Stack>
        </MuiBox>
  )
}
