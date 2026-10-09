import type { FormEventHandler } from 'react'
import {
  Box as MuiBox,
  Dialog,
  Stack,
  Typography as MuiTypography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActionSpacer, XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'
import {
  XDriveSourceNameField,
  XDriveSourceRunModeField,
  XDriveSourceStatusField,
  XDriveSourceSyncModeField,
} from './SourceBasicFields'
import {
  XDriveSourceCookieField,
  XDriveSourceTargetField,
  XDriveStoredCredentialField,
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
  externalSourceCredentialTestSuccessLabel,
  externalSourceMirrorSafetyNotice,
  externalSourceMirrorScanNotice,
  yikeRateLimitNotice,
} from '../external-sources'
import type {
  ExternalSourceCredentialReveal,
  ExternalSourceCredentialTestResult,
  ExternalSourceDirectoryBrowser,
  ExternalSourceRow,
  ExternalSourceScheduleType,
  ExternalSourceSyncMode,
  SynologyPhotoSpace,
} from '../external-sources'

export type XDriveSourceSettingsValues = {
  name: string
  sync_mode: ExternalSourceSyncMode
  run_mode: 'scan' | 'sync'
  status: 'active' | 'paused'
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

export function XDriveSourceSettingsDialog({
  setting,
  saving,
  values,
  nameError,
  spacesError,
  rootsError,
  cookieHelpVariant,
  revealingCredential,
  testingCredential,
  credentialReveal,
  credentialTest,
  credentialTestError,
  connectorConfigLoaded,
  connectorConfigLoading,
  connectorConfigError,
  clearingCredential,
  browseDirectories,
  onRequestClose,
  onCancel,
  onRetryConnectorConfig,
  onSubmit,
  onChange,
  onCredentialChange,
  onClearNameError,
  onClearSpacesError,
  onClearRootsError,
  onRevealCredential,
  onHideCredential,
  onTestCredential,
  onRequestClearCredential,
  onDelete,
}: {
  setting: ExternalSourceRow | null
  saving: boolean
  values: XDriveSourceSettingsValues
  nameError: string
  spacesError: string
  rootsError: string
  cookieHelpVariant: 'accordion' | 'dialog'
  revealingCredential: boolean
  testingCredential: boolean
  credentialReveal: ExternalSourceCredentialReveal | null
  credentialTest: ExternalSourceCredentialTestResult | null
  credentialTestError: string
  connectorConfigLoaded: boolean
  connectorConfigLoading: boolean
  connectorConfigError: string
  clearingCredential: boolean
  browseDirectories?: ExternalSourceDirectoryBrowser
  onRequestClose: () => void
  onCancel: () => void
  onRetryConnectorConfig: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onChange: (patch: Partial<XDriveSourceSettingsValues>) => void
  onCredentialChange: (patch: Partial<XDriveSourceSettingsValues>) => void
  onClearNameError: () => void
  onClearSpacesError: () => void
  onClearRootsError: () => void
  onRevealCredential: () => void
  onHideCredential: () => void
  onTestCredential: () => void
  onRequestClearCredential: () => void
  onDelete: () => void
}) {
  const profile = setting
    ? externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    : null

  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  return (
    <Dialog
      open={!!setting}
      onClose={() => {
        if (!saving) onRequestClose()
      }}
      maxWidth="sm"
      fullWidth
      fullScreen={compactTouch}
      scroll="paper"
      slotProps={{ paper: dialogPaper }}
    >
      <XDriveDialogTitle
        title={setting ? `${setting.source.name} · 设置` : '同步文件夹设置'}
        onClose={onRequestClose}
        closeDisabled={saving}
      />
      <XDriveDialogContent dividers>
        {setting ? (
          <MuiBox id="external-source-settings-form" component="form" onSubmit={onSubmit}>
            <Stack spacing={2}>
              <XDriveSourceNameField
                autoFocus={!compactTouch}
                value={values.name}
                error={Boolean(nameError)}
                helperText={nameError || ' '}
                onChange={(value) => {
                  onChange({ name: value })
                  if (nameError) onClearNameError()
                }}
              />
              {setting.source.kind === 'local_folder' ? (
                <XDriveStatusAlert tone="neutral">
                  此同步文件夹目前只能管理名称、目标路径和忽略规则。设备授权已可配置，
                  但扫描、上传、镜像删除和自动任务仍未启用，当前不能激活来源。
                </XDriveStatusAlert>
              ) : (
                <>
              <XDriveSourceRunModeField
                value={values.run_mode}
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
              <XDriveSourceStatusField
                label="同步状态"
                value={values.status}
                onChange={(value) => onChange({ status: value })}
              />
                </>
              )}
              <XDriveSourceTargetField
                value={setting.source.target_path}
                managed={setting.source.kind === 'yike_photos'}
              />
              {setting.source.kind !== 'local_folder' ? (
                <XDriveSourceScheduleFields
                  wideAt="md"
                  scheduleType={values.schedule_type}
                  expression={values.schedule_expression}
                  timezone={values.schedule_timezone}
                  onScheduleTypeChange={(value) => onChange({ schedule_type: value })}
                  onExpressionChange={(value) => onChange({ schedule_expression: value })}
                  onTimezoneChange={(value) => onChange({ schedule_timezone: value })}
                />
              ) : null}
              <XDriveSourceIgnoreRulesField
                rows={6}
                placeholder={'每行一条规则，例如：\n@eaDir/\n*.tmp\n!important.jpg'}
                value={values.ignore_rules ?? ''}
                onChange={(value) => onChange({ ignore_rules: value })}
                monospace
              />

              {profile?.credential === 'cookie' ? (
                <>
                  <XDriveSectionHeader level="h3" title="一刻相册凭据" />
                  <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 0.5 }}>
                    <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {setting.credential?.configured ? 'Cookie 已配置' : 'Cookie 未配置'}
                    </MuiTypography>
                    <MuiTypography variant="body2">
                      Cookie 默认仅显示遮罩；点击“显示”后临时读取明文，30 秒后自动重新隐藏。
                    </MuiTypography>
                  </XDriveStatusAlert>
                  <XDriveStoredCredentialField
                    label="已保存 Cookie"
                    configured={Boolean(setting.credential?.configured)}
                    revealedValue={credentialReveal?.field === 'cookie' ? credentialReveal.value : ''}
                    loading={revealingCredential}
                    expiresInSeconds={credentialReveal?.expires_in_seconds ?? 30}
                    updatedAtLabel={setting.credential?.updated_at ? new Date(setting.credential.updated_at).toLocaleString('zh-CN') : undefined}
                    onReveal={onRevealCredential}
                    onHide={onHideCredential}
                  />
                  <XDriveStatusAlert tone="neutral" sx={{ mb: 0.5 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
                  <XDriveSourceCookieField
                    label="替换 Cookie"
                    value={values.cookie ?? ''}
                    placeholder={setting.credential?.configured ? '留空则保持当前 Cookie 不变' : '粘贴一刻相册 Cookie'}
                    helperText={setting.credential?.configured
                      ? '只在需要更换 Cookie 时填写；已显示的 Cookie 不会自动带入此输入框。'
                      : '当前未配置 Cookie，请粘贴新的 Cookie。'}
                    onChange={(value) => onCredentialChange({ cookie: value })}
                  />
                  <MuiBox>
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
                  {setting.credential?.configured ? (
                    <MuiBox>
                      <XDriveActionButton
                        intent="danger"
                        disabled={clearingCredential}
                        onClick={onRequestClearCredential}
                      >
                        清除 Cookie
                      </XDriveActionButton>
                    </MuiBox>
                  ) : null}
                </>
              ) : null}

              {profile?.credential === 'synology_dsm' ? (
                <>
                  <XDriveSectionHeader level="h3" title="Synology DSM 凭据" />
                  <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 0.5 }}>
                    <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {setting.credential?.configured ? 'DSM 凭据已配置' : 'DSM 凭据未配置'}
                    </MuiTypography>
                    <MuiTypography variant="body2">
                      DSM 密码默认仅显示遮罩，可按需临时显示 30 秒；如需更新连接，请重新完整填写地址、用户名和密码。
                    </MuiTypography>
                  </XDriveStatusAlert>
                  <XDriveStoredCredentialField
                    label="已保存 DSM 密码"
                    configured={Boolean(setting.credential?.configured)}
                    revealedValue={credentialReveal?.field === 'password' ? credentialReveal.value : ''}
                    loading={revealingCredential}
                    expiresInSeconds={credentialReveal?.expires_in_seconds ?? 30}
                    updatedAtLabel={setting.credential?.updated_at ? new Date(setting.credential.updated_at).toLocaleString('zh-CN') : undefined}
                    onReveal={onRevealCredential}
                    onHide={onHideCredential}
                  />
                  <XDriveSynologyDsmCredentialFields
                    mode="update"
                    baseURL={values.base_url ?? ''}
                    username={values.username ?? ''}
                    password={values.password ?? ''}
                    onBaseURLChange={(value) => onCredentialChange({ base_url: value })}
                    onUsernameChange={(value) => onCredentialChange({ username: value })}
                    onPasswordChange={(value) => onCredentialChange({ password: value })}
                  />
                  {connectorConfigError ? (
                    <XDriveStatusAlert tone="bad">
                      <Stack spacing={1} alignItems="flex-start">
                        <MuiTypography variant="body2">{connectorConfigError}</MuiTypography>
                        <XDriveActionButton
                          compact
                          disabled={saving || connectorConfigLoading}
                          onClick={onRetryConnectorConfig}
                        >
                          重试加载配置
                        </XDriveActionButton>
                      </Stack>
                    </XDriveStatusAlert>
                  ) : connectorConfigLoading ? (
                    <XDriveStatusAlert tone="neutral">正在读取当前同步范围，完成后才能保存设置。</XDriveStatusAlert>
                  ) : null}
                  {setting.source.kind === 'synology_photos' ? (
                    <>
                      {connectorConfigLoaded ? (
                        <XDriveSynologyPhotoSpacesField
                          value={values.spaces ?? []}
                          error={Boolean(spacesError)}
                          helperText={spacesError || '至少选择一个照片空间'}
                          onChange={(value) => {
                            onChange({ spaces: value })
                            if (spacesError) onClearSpacesError()
                          }}
                        />
                      ) : null}
                    </>
                  ) : connectorConfigLoaded ? (
                    <XDriveSynologyFileRootsField
                      value={values.roots ?? []}
                      error={Boolean(rootsError)}
                      helperText={rootsError || '每行一个 DSM 绝对目录；修改根目录不会删除已备份到 xDrive 的文件。'}
                      browse={setting.credential?.configured ? browseDirectories : undefined}
                      onChange={(value) => {
                        onChange({ roots: value })
                        if (rootsError) onClearRootsError()
                      }}
                    />
                  ) : null}
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
                  {setting.credential?.configured ? (
                    <MuiBox>
                      <XDriveActionButton
                        intent="danger"
                        disabled={clearingCredential}
                        onClick={onRequestClearCredential}
                      >
                        清除 DSM 凭据
                      </XDriveActionButton>
                    </MuiBox>
                  ) : null}
                </>
              ) : null}
            </Stack>
          </MuiBox>
        ) : null}
      </XDriveDialogContent>

      {setting ? (
        <XDriveDialogActions>
          <XDriveActionButton
            intent="danger"
            disabled={saving || setting.latestRun?.status === 'running'}
            onClick={onDelete}
          >
            删除同步文件夹
          </XDriveActionButton>
          <XDriveDialogActionSpacer />
          <XDriveActionButton disabled={saving} onClick={onCancel}>取消</XDriveActionButton>
          <XDriveActionButton
            intent="primary"
            type="submit"
            form="external-source-settings-form"
            disabled={profile?.credential === 'synology_dsm' && (!connectorConfigLoaded || connectorConfigLoading || Boolean(connectorConfigError))}
            loading={saving}
            loadingLabel="正在保存…"
          >
            保存设置
          </XDriveActionButton>
        </XDriveDialogActions>
      ) : null}
    </Dialog>
  )
}
