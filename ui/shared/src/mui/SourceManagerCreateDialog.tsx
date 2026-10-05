import type { FormEventHandler } from 'react'
import {
  Box as MuiBox,
  Button as MuiButton,
  CircularProgress,
  Dialog,
  Stack,
  Typography as MuiTypography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import {
  XDriveSourceNameField,
  XDriveSourcePresetField,
  XDriveSourceRunModeField,
  XDriveSourceSyncModeField,
} from './SourceBasicFields'
import {
  XDriveSourceCookieField,
  XDriveSynologyDsmCredentialFields,
} from './SourceCredentialFields'
import {
  XDriveSynologyFileRootsField,
  XDriveSynologyPhotoSpacesField,
} from './SourceConnectorConfigFields'
import { XDriveSourceIgnoreRulesField } from './SourceIgnoreRulesField'
import { XDriveSourceScheduleFields } from './SourceScheduleFields'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveYikeCookieHelp } from './YikeCookieHelp'
import {
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCredentialTestSuccessLabel,
  externalSourceMirrorSafetyNotice,
  externalSourceMirrorScanNotice,
  yikeConnectorNotice,
  yikeManagedTargetLabel,
  yikeRateLimitNotice,
} from '../external-sources'
import type {
  ExternalSourceCreatePreset,
  ExternalSourceCredentialTestResult,
  ExternalSourceScheduleType,
  ExternalSourceSyncMode,
  SynologyPhotoSpace,
} from '../external-sources'

export type XDriveSourceCreateValues = {
  preset: ExternalSourceCreatePreset
  name: string
  sync_mode: ExternalSourceSyncMode
  run_mode: 'scan' | 'sync'
  schedule_type: ExternalSourceScheduleType
  schedule_expression: string
  schedule_timezone: string
  ignore_rules?: string
  cookie?: string
  base_url?: string
  username?: string
  password?: string
  spaces?: SynologyPhotoSpace[]
  roots?: string[]
}

type SourceTargetNode = {
  id: number
  name: string
  path?: string
}

export function XDriveSourceCreateDialog({
  open,
  creating,
  values,
  nameError,
  spacesError,
  rootsError,
  targetBrowsingEnabled,
  targetCrumbs,
  targetDirectories,
  targetLoading,
  defaultTargetLabel,
  defaultTargetPath,
  cookieHelpVariant,
  testingCredential,
  credentialTest,
  credentialTestError,
  onRequestClose,
  onCancel,
  onSubmit,
  onPresetChange,
  onChange,
  onCredentialChange,
  onClearNameError,
  onClearSpacesError,
  onClearRootsError,
  onLoadTargetDirectory,
  onTestCredential,
}: {
  open: boolean
  creating: boolean
  values: XDriveSourceCreateValues
  nameError: string
  spacesError: string
  rootsError: string
  targetBrowsingEnabled: boolean
  targetCrumbs: SourceTargetNode[]
  targetDirectories: SourceTargetNode[]
  targetLoading: boolean
  defaultTargetLabel: string
  defaultTargetPath: string
  cookieHelpVariant: 'accordion' | 'dialog'
  testingCredential: boolean
  credentialTest: ExternalSourceCredentialTestResult | null
  credentialTestError: string
  onRequestClose: () => void
  onCancel: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onPresetChange: (preset: ExternalSourceCreatePreset) => void
  onChange: (patch: Partial<XDriveSourceCreateValues>) => void
  onCredentialChange: (patch: Partial<XDriveSourceCreateValues>) => void
  onClearNameError: () => void
  onClearSpacesError: () => void
  onClearRootsError: () => void
  onLoadTargetDirectory: (node: SourceTargetNode, crumbs: SourceTargetNode[]) => void
  onTestCredential: () => void
}) {
  const option = externalSourceCreateOption(values.preset)
  const profile = externalSourceConnectorProfile(option.kind, option.direction)
  const selectedTarget = targetCrumbs.at(-1)
  const selectedTargetLabel = targetBrowsingEnabled
    ? (targetCrumbs.map((item) => item.name).join(' / ') || defaultTargetLabel)
    : defaultTargetLabel
  const selectedTargetPath = targetBrowsingEnabled ? (selectedTarget?.path ?? '') : defaultTargetPath

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!creating) onRequestClose()
      }}
      maxWidth="sm"
      fullWidth
      scroll="paper"
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle
        title="添加同步文件夹"
        onClose={onRequestClose}
        closeDisabled={creating}
      />
      <XDriveDialogContent dividers>
        {option.kind === 'yike_photos' ? (
          <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
            固定逻辑目录：{yikeManagedTargetLabel}。连接成功后由服务器按百度 UID 和账号名称自动创建；底层文件仍使用 xDrive CAS 存储。
          </XDriveStatusAlert>
        ) : targetBrowsingEnabled ? (
          <MuiBox sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
            >
              <MuiBox>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>目标文件夹</MuiTypography>
                <MuiTypography variant="body2" color="text.secondary">
                  当前选择：{selectedTargetLabel || '正在加载…'}
                </MuiTypography>
              </MuiBox>
              {targetLoading ? <CircularProgress size={18} /> : null}
            </Stack>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              {targetCrumbs.map((crumb, index) => (
                <MuiButton
                  key={crumb.id}
                  size="small"
                  variant={index === targetCrumbs.length - 1 ? 'contained' : 'text'}
                  disabled={targetLoading || index === targetCrumbs.length - 1}
                  onClick={() => onLoadTargetDirectory(crumb, targetCrumbs.slice(0, index + 1))}
                >
                  {crumb.name}
                </MuiButton>
              ))}
            </Stack>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {targetDirectories.length === 0 && !targetLoading ? (
                <MuiTypography variant="caption" color="text.secondary">
                  当前目录下没有子文件夹，可直接使用当前目录。
                </MuiTypography>
              ) : targetDirectories.map((directory) => (
                <MuiButton
                  key={directory.id}
                  variant="outlined"
                  size="small"
                  disabled={targetLoading}
                  onClick={() => onLoadTargetDirectory(directory, [...targetCrumbs, directory])}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>{directory.name}</span>
                  <span>进入文件夹 ›</span>
                </MuiButton>
              ))}
            </Stack>
            {option.direction === 'pull' ? (
              <MuiTypography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Pull 模式由 xDrive Server 直接连接 DSM；请确保服务器网络可以访问下面填写的 DSM 地址。
              </MuiTypography>
            ) : null}
          </MuiBox>
        ) : (
          <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
            <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>目标目录使用当前文件夹</MuiTypography>
            <MuiTypography variant="body2">
              当前目标：{selectedTargetLabel}{selectedTargetPath ? `（${selectedTargetPath}）` : '（我的文件根目录）'}
            </MuiTypography>
            {option.direction === 'pull' ? (
              <MuiTypography variant="body2" sx={{ mt: 0.5 }}>
                Pull 模式由 xDrive Server 直接连接 DSM；请确保服务器网络可以访问下面填写的 DSM 地址。
              </MuiTypography>
            ) : null}
          </XDriveStatusAlert>
        )}

        <MuiBox id="external-source-create-form" component="form" onSubmit={onSubmit}>
          <Stack spacing={2}>
            <XDriveSourcePresetField
              value={values.preset}
              onChange={onPresetChange}
            />
            <XDriveSourceNameField
              value={values.name}
              error={Boolean(nameError)}
              helperText={nameError || ' '}
              onChange={(value) => {
                onChange({ name: value })
                if (nameError) onClearNameError()
              }}
            />
            <XDriveSourceRunModeField
              label="初始运行模式"
              value={values.run_mode}
              scanLabel="仅扫描（推荐先使用）"
              onChange={(value) => onChange({ run_mode: value })}
            />
            <XDriveSourceSyncModeField
              value={values.sync_mode}
              onChange={(value) => onChange({ sync_mode: value })}
            />
            {values.sync_mode === 'mirror' ? (
              <XDriveStatusAlert tone="warning">
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>镜像到回收站</MuiTypography>
                <MuiTypography variant="body2">{externalSourceMirrorSafetyNotice}</MuiTypography>
                {values.run_mode === 'scan' ? (
                  <MuiTypography variant="body2" sx={{ mt: 0.5 }}>{externalSourceMirrorScanNotice}</MuiTypography>
                ) : null}
              </XDriveStatusAlert>
            ) : null}
            <XDriveSourceScheduleFields
              wideAt="md"
              scheduleType={values.schedule_type}
              expression={values.schedule_expression}
              timezone={values.schedule_timezone}
              onScheduleTypeChange={(value) => onChange({ schedule_type: value })}
              onExpressionChange={(value) => onChange({ schedule_expression: value })}
              onTimezoneChange={(value) => onChange({ schedule_timezone: value })}
            />
            <XDriveSourceIgnoreRulesField
              value={values.ignore_rules ?? ''}
              onChange={(value) => onChange({ ignore_rules: value })}
              monospace
            />

            {profile.credential === 'cookie' ? (
              <>
                <XDriveSourceCookieField
                  value={values.cookie ?? ''}
                  helperText="Cookie 只会加密保存到服务器，之后不会回传到浏览器。"
                  onChange={(value) => onCredentialChange({ cookie: value })}
                />
                <MuiBox>
                  <XDriveStatusAlert tone="warning" sx={{ mb: 1 }}>{yikeConnectorNotice}</XDriveStatusAlert>
                  <XDriveStatusAlert tone="neutral" sx={{ mb: 1 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
                  <XDriveYikeCookieHelp variant={cookieHelpVariant} />
                  <MuiBox sx={{ mt: 1 }}>
                    <XDriveActionButton
                      compact
                      disabled={testingCredential}
                      loading={testingCredential}
                      loadingLabel="正在测试…"
                      onClick={onTestCredential}
                    >
                      测试连接
                    </XDriveActionButton>
                  </MuiBox>
                  {credentialTest ? (
                    <XDriveStatusAlert tone="good" sx={{ mt: 1 }}>
                      {externalSourceCredentialTestSuccessLabel(credentialTest)}
                    </XDriveStatusAlert>
                  ) : null}
                  {credentialTestError ? (
                    <XDriveStatusAlert tone="bad" sx={{ mt: 1 }}>{credentialTestError}</XDriveStatusAlert>
                  ) : null}
                </MuiBox>
              </>
            ) : null}

            {profile.credential === 'synology_dsm' ? (
              <>
                <XDriveSectionHeader level="h3" title="Synology DSM 连接" />
                <XDriveSynologyDsmCredentialFields
                  baseURL={values.base_url ?? ''}
                  username={values.username ?? ''}
                  password={values.password ?? ''}
                  onBaseURLChange={(value) => onCredentialChange({ base_url: value })}
                  onUsernameChange={(value) => onCredentialChange({ username: value })}
                  onPasswordChange={(value) => onCredentialChange({ password: value })}
                />
                {option.kind === 'synology_photos' ? (
                  <XDriveSynologyPhotoSpacesField
                    value={values.spaces ?? []}
                    error={Boolean(spacesError)}
                    helperText={spacesError || '至少选择一个照片空间'}
                    onChange={(value) => {
                      onChange({ spaces: value })
                      if (spacesError) onClearSpacesError()
                    }}
                  />
                ) : (
                  <XDriveSynologyFileRootsField
                    value={values.roots ?? []}
                    error={Boolean(rootsError)}
                    helperText={rootsError || '每行一个 DSM 绝对目录；会同步目录、空目录及其中的任意文件类型。'}
                    onChange={(value) => {
                      onChange({ roots: value })
                      if (rootsError) onClearRootsError()
                    }}
                  />
                )}
                <XDriveStatusAlert tone="neutral" sx={{ mb: 1 }}>
                  {option.kind === 'synology_files'
                    ? 'DSM 凭据只会在服务器端加密保存；Pull worker 通过 File Station API 只读同步所选目录中的所有文件和文件夹，不会修改 NAS 内容。'
                    : 'DSM 凭据只会在服务器端加密保存；Pull worker 使用 Synology Photos API 只读发现和下载媒体，不会删除 NAS 中的照片。'}
                </XDriveStatusAlert>
                <MuiBox>
                  <XDriveActionButton
                    compact
                    disabled={testingCredential}
                    loading={testingCredential}
                    loadingLabel="正在测试…"
                    onClick={onTestCredential}
                  >
                    测试连接
                  </XDriveActionButton>
                </MuiBox>
                {credentialTest ? (
                  <XDriveStatusAlert tone="good">
                    {externalSourceCredentialTestSuccessLabel(credentialTest)}
                  </XDriveStatusAlert>
                ) : null}
                {credentialTestError ? <XDriveStatusAlert tone="bad">{credentialTestError}</XDriveStatusAlert> : null}
              </>
            ) : null}
          </Stack>
        </MuiBox>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton onClick={onCancel}>取消</XDriveActionButton>
        <XDriveActionButton
          intent="primary"
          type="submit"
          form="external-source-create-form"
          loading={creating}
          loadingLabel="正在添加…"
        >
          添加同步文件夹
        </XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
