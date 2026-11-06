import type { FormEventHandler } from 'react'
import {
  Box as MuiBox,
  Dialog,
  Stack,
  Typography as MuiTypography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'
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

export function XDriveSourceCreateDialog({
  open,
  creating,
  allowLocalPush = false,
  directionFilter,
  values,
  nameError,
  spacesError,
  rootsError,
  cookieHelpVariant,
  testingCredential,
  credentialTest,
  credentialTestError,
  onRequestClose,
  onCancel,
  onSubmit,
  onPresetChange,
  onChange,
  onNameEdit,
  onCredentialChange,
  onClearNameError,
  onClearSpacesError,
  onClearRootsError,
  onTestCredential,
}: {
  open: boolean
  creating: boolean
  allowLocalPush?: boolean
  directionFilter?: 'pull'
  values: XDriveSourceCreateValues
  nameError: string
  spacesError: string
  rootsError: string
  cookieHelpVariant: 'accordion' | 'dialog'
  testingCredential: boolean
  credentialTest: ExternalSourceCredentialTestResult | null
  credentialTestError: string
  onRequestClose: () => void
  onCancel: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onPresetChange: (preset: ExternalSourceCreatePreset) => void
  onChange: (patch: Partial<XDriveSourceCreateValues>) => void
  onNameEdit?: () => void
  onCredentialChange: (patch: Partial<XDriveSourceCreateValues>) => void
  onClearNameError: () => void
  onClearSpacesError: () => void
  onClearRootsError: () => void
  onTestCredential: () => void
}) {
  const sourceNoun = directionFilter === 'pull' ? '拉取来源' : '来源'
  const option = externalSourceCreateOption(values.preset)
  const profile = externalSourceConnectorProfile(option.kind, option.direction)
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!creating) onRequestClose()
      }}
      maxWidth="sm"
      fullWidth
      fullScreen={compactTouch}
      scroll="paper"
      slotProps={{ paper: dialogPaper }}
    >
      <XDriveDialogTitle
        title={option.kind === 'synology_photos' && option.direction === 'push' ? '配置 DSM Photos Push' : `添加${sourceNoun}`}
        onClose={onRequestClose}
        closeDisabled={creating}
      />
      <XDriveDialogContent dividers>
        <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
          {option.kind === 'synology_photos' && option.direction === 'push'
            ? 'DSM Push 必须由 NAS 端 Source Agent 注册设备及授权本地 Root。下方只生成配置命令，不会在浏览器中创建未绑定设备的来源。'
            : '云端目标目录：'}
          {option.direction === 'push'
            ? `同步文件夹 / Push / ${values.name.trim() || '目录名称'}`
            : `同步文件夹 / Pull / ${(option.kind === 'synology_files' ? 'Synology Files' : option.kind === 'synology_photos' ? 'Synology Photos' : 'Yike Photos')} / ${values.name.trim() || '目录名称'}`}
          <br />
          只允许修改最后一级目录名称；同步文件夹、Push/Pull 和连接器目录由 Server 统一创建。
          不提供任意目标目录选择，也不会认领已有普通目录。
        </XDriveStatusAlert>

        <MuiBox id="external-source-create-form" component="form" onSubmit={onSubmit}>
          <Stack spacing={2}>
            <XDriveSourcePresetField
              directionFilter={directionFilter}
              allowLocalPush={allowLocalPush}
              value={values.preset}
              onChange={onPresetChange}
            />
            <XDriveSourceNameField
              label="目标文件夹名称"
              value={values.name}
              error={Boolean(nameError)}
              helperText={nameError || '仅填写最后一级目录名称；Push/Pull 前缀由 Server 固定管理。'}
              onChange={(value) => {
                onNameEdit?.()
                onChange({ name: value })
                if (nameError) onClearNameError()
              }}
            />
            {option.kind === 'local_folder' ? (
              <XDriveStatusAlert tone="neutral">
                本机文件夹会先在云端创建暂停的来源，随后由 Desktop 原生目录选择器完成本机 Root 授权。
                扫描、上传与自动同步执行器尚未启用，当前不会传输或删除任何文件。
              </XDriveStatusAlert>
            ) : option.kind === 'synology_photos' && option.direction === 'push' ? (
              <>
                <XDriveSourceRunModeField
                  label="初始运行模式"
                  value={values.run_mode}
                  scanLabel="仅扫描（推荐先使用）"
                  onChange={(value) => onChange({ run_mode: value })}
                />
                <XDriveStatusAlert tone="neutral">
                  DSM Photos Push 仅支持备份模式。NAS 中删除照片不会自动删除云端备份；完成 NAS setup 后可管理计划和忽略规则。
                </XDriveStatusAlert>
              </>
            ) : (
              <>
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
              </>
            )}
            {option.kind !== 'local_folder' && !(option.kind === 'synology_photos' && option.direction === 'push') ? <XDriveSourceScheduleFields
              wideAt="md"
              scheduleType={values.schedule_type}
              expression={values.schedule_expression}
              timezone={values.schedule_timezone}
              onScheduleTypeChange={(value) => onChange({ schedule_type: value })}
              onExpressionChange={(value) => onChange({ schedule_expression: value })}
              onTimezoneChange={(value) => onChange({ schedule_timezone: value })}
            /> : null}
            {!(option.kind === 'synology_photos' && option.direction === 'push') ? (
              <XDriveSourceIgnoreRulesField
                value={values.ignore_rules ?? ''}
                onChange={(value) => onChange({ ignore_rules: value })}
                monospace
              />
            ) : null}

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
                    ? 'DSM 凭据只会在服务器端加密保存；服务器通过 File Station API 只读拉取所选目录中的所有文件和文件夹，不会修改 NAS 内容。'
                    : 'DSM 凭据只会在服务器端加密保存；服务器通过 Synology Photos API 只读发现和下载媒体，不会删除 NAS 中的照片。'}
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
          {option.kind === 'synology_photos' && option.direction === 'push' ? '打开 DSM 配置指南' : `添加${sourceNoun}`}
        </XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
