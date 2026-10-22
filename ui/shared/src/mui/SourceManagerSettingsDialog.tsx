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
  XDriveSourceTargetField,
  XDriveSynologyDsmCredentialFields,
} from './SourceCredentialFields'
import { XDriveSensitiveField } from './SensitiveField'
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
  externalSourceDisplayName,
  externalSourceDisplayTargetPath,
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
  const sourceNoun = setting?.source.direction === 'pull' ? '拉取来源' : '来源'
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
        title={setting ? `${externalSourceDisplayName(setting.source)} · 设置` : `${sourceNoun}设置`}
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
                  此来源目前只能管理名称、目标路径和忽略规则。设备授权已可配置，
                  但扫描、上传、镜像删除和自动任务仍未启用，当前不能激活来源。
                </XDriveStatusAlert>
              ) : (
                <>
              <XDriveSourceRunModeField
                value={values.run_mode}
                onChange={(value) => onChange({ run_mode: value })}
              />
              <XDriveSourceSyncModeField
                label={setting.source.direction === 'pull' ? '数据保留策略' : '同步策略'}
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
                label="运行状态"
                value={values.status}
                onChange={(value) => onChange({ status: value })}
              />
                </>
              )}
              <XDriveSourceTargetField
                value={externalSourceDisplayTargetPath(setting.source)}
                label={setting.source.kind === 'yike_photos' && setting.source.direction === 'pull' ? '存储子目录' : '目标目录'}
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
                  <XDriveSensitiveField label="一刻相册 Cookie"
                    configured={Boolean(setting.credential?.configured)}
                    revealedValue={credentialReveal?.field === 'cookie' ? credentialReveal.value : ''}
                    revealLoading={revealingCredential}
                    onReveal={onRevealCredential} onHide={onHideCredential}
                    value={values.cookie ?? ''}
                    onChange={(value) => onCredentialChange({ cookie: value })} />
                  <XDriveStatusAlert tone="neutral" sx={{ mb: 0.5 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
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
                  <XDriveSynologyDsmCredentialFields
                    mode="update"
                    configured={Boolean(setting.credential?.configured)}
                    revealedPassword={credentialReveal?.field === 'password' ? credentialReveal.value : ''}
                    passwordRevealLoading={revealingCredential}
                    onRevealPassword={onRevealCredential}
                    onHidePassword={onHideCredential}
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
                    <XDriveStatusAlert tone="neutral">正在读取远程目录范围，完成后才能保存设置。</XDriveStatusAlert>
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
            删除{sourceNoun}
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
