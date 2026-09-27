import { useCallback, useEffect, useState } from 'react'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, Card, Descriptions, Divider, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Tooltip, Typography, message } from 'antd'
import type { BadgeProps } from 'antd'
import {
  Alert as MuiAlert,
  Button as MuiButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import type { XDriveApi } from './api'
import SynologyDsmGuideDialog from './SynologyDsmGuideDialog'
import {
  externalSourceCardView,
  externalSourceConnectorProfile,
  externalSourceCredentialTestErrorLabel,
  externalSourceCredentialTestSuccessLabel,
  externalSourceDefaults,
  externalSourceDetailView,
  externalSourceRunDetailView,
  formatExternalSourceTime,
  formatSize,
} from '../../ui/shared/src'
import type {
  ExternalSource,
  ExternalSourceCredentialTestResult,
  ExternalSourceRow,
  ExternalSourceStateTone,
  SupportedExternalSourceKind,
} from '../../ui/shared/src'

type SourceSettingsValues = {
  name: string
  run_mode: 'scan' | 'sync'
  status: 'active' | 'paused'
  ignore_rules?: string
  cookie?: string
}
type CreateSourceValues = {
  kind: SupportedExternalSourceKind
  name: string
  run_mode: 'scan' | 'sync'
  ignore_rules?: string
  cookie?: string
}


function sourceBadgeStatus(tone: ExternalSourceStateTone): BadgeProps['status'] {
  if (tone === 'good') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'bad') return 'error'
  if (tone === 'busy') return 'processing'
  return 'default'
}


export default function ExternalSourcesPanel({
  open,
  api,
  defaultTargetNodeID,
  defaultTargetLabel,
  defaultTargetPath,
  onClose,
  onError,
}: {
  open: boolean
  api: XDriveApi
  defaultTargetNodeID?: number
  defaultTargetLabel: string
  defaultTargetPath: string
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const [rows, setRows] = useState<ExternalSourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ExternalSourceRow | null>(null)
  const [setting, setSetting] = useState<ExternalSourceRow | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm] = Form.useForm<SourceSettingsValues>()
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [triggeringSourceID, setTriggeringSourceID] = useState<number | null>(null)
  const [testingCreateCredential, setTestingCreateCredential] = useState(false)
  const [createCredentialTest, setCreateCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [createCredentialTestError, setCreateCredentialTestError] = useState('')
  const [testingSettingsCredential, setTestingSettingsCredential] = useState(false)
  const [settingsCredentialTest, setSettingsCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [settingsCredentialTestError, setSettingsCredentialTestError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ExternalSourceRow | null>(null)
  const [deletingSourceID, setDeletingSourceID] = useState<number | null>(null)
  const [guideSource, setGuideSource] = useState<ExternalSource | null>(null)
  const [guideUsername, setGuideUsername] = useState<string | undefined>()
  const [createForm] = Form.useForm<CreateSourceValues>()
  const createKind = Form.useWatch('kind', createForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sources = await api.sources()
      const next = await Promise.all(sources.map(async (source) => {
        const [runs, credential] = await Promise.all([
          api.sourceRuns(source.id, 1),
          externalSourceConnectorProfile(source.kind).credential === 'cookie'
            ? api.sourceCredentialStatus(source.id)
            : Promise.resolve(undefined),
        ])
        return { source, latestRun: runs[0], credential }
      }))
      setRows(next)
    } catch (error) {
      onError(error)
    } finally {
      setLoading(false)
    }
  }, [api, onError])

  useEffect(() => {
    if (open) void load()
  }, [open, load])
  const openSynologyGuide = (source: ExternalSource) => {
    setGuideSource(source)
    void api.me()
      .then((me) => setGuideUsername(me.username))
      .catch(() => setGuideUsername(undefined))
  }

  const openCreate = () => {
    const defaults = externalSourceDefaults('synology_photos')
    createForm.setFieldsValue({
      kind: defaults.kind,
      name: defaults.name,
      run_mode: 'scan',
      ignore_rules: defaults.ignoreRules,
      cookie: '',
    })
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    setCreateOpen(true)
  }

  const changeCreateKind = (kind: CreateSourceValues['kind']) => {
    const defaults = externalSourceDefaults(kind)
    createForm.setFieldsValue({
      name: defaults.name,
      ignore_rules: defaults.ignoreRules,
      cookie: '',
    })
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
  }

  const testCreateCookie = async () => {
    const cookie = String(createForm.getFieldValue('cookie') ?? '').trim()
    if (!cookie) {
      setCreateCredentialTest(null)
      setCreateCredentialTestError('请先填写一刻相册 Cookie')
      return null
    }
    setTestingCreateCredential(true)
    setCreateCredentialTestError('')
    try {
      const result = await api.testSourceCredential('yike_photos', { cookie })
      setCreateCredentialTest(result)
      return result
    } catch (error) {
      setCreateCredentialTest(null)
      setCreateCredentialTestError(externalSourceCredentialTestErrorLabel(error instanceof Error ? error.message : String(error)))
      return null
    } finally {
      setTestingCreateCredential(false)
    }
  }

  const createSource = async (values: CreateSourceValues) => {
    if (!defaultTargetNodeID) {
      message.error('当前目标文件夹尚未加载，请稍后重试')
      return
    }
    const cookie = values.cookie?.trim() ?? ''
    if (values.kind === 'yike_photos' && !cookie) {
      message.error('请填写一刻相册 Cookie')
      return
    }

    setCreating(true)
    if (values.kind === 'yike_photos') {
      const tested = await testCreateCookie()
      if (!tested) {
        setCreating(false)
        return
      }
    }
    let created: ExternalSource
    try {
      created = await api.createSource({
        name: values.name.trim(),
        kind: values.kind,
        direction: externalSourceDefaults(values.kind).direction,
        sync_mode: 'backup',
        run_mode: values.run_mode,
        target_node_id: defaultTargetNodeID,
        ignore_rules: values.ignore_rules ?? '',
      })
    } catch (error) {
      onError(error)
      setCreating(false)
      return
    }

    let credentialSaved = true
    if (values.kind === 'yike_photos') {
      try {
        await api.setSourceCredential(created.id, { cookie })
      } catch (error) {
        credentialSaved = false
        onError(error)
        message.warning('来源已创建，但 Cookie 保存失败；请在“设置”中重新配置')
      }
    }

    if (credentialSaved) message.success('外部来源已添加')
    setCreateOpen(false)
    createForm.resetFields()
    await load()
    setCreating(false)

    if (values.kind === 'synology_photos') {
      openSynologyGuide(created)
    }
  }


  const triggerNow = async (row: ExternalSourceRow) => {
    setTriggeringSourceID(row.source.id)
    try {
      await api.triggerSource(row.source.id)
      message.success(row.source.kind === 'synology_photos'
        ? '已请求立即扫描，等待群晖 source-agent 下一次任务检查'
        : '已请求立即扫描，Pull worker 将在下一次轮询时开始')
      await load()
    } catch (error) {
      onError(error)
    } finally {
      setTriggeringSourceID(null)
    }
  }

  const openSettings = (row: ExternalSourceRow) => {
    setSetting(row)
    settingsForm.setFieldsValue({
      name: row.source.name,
      run_mode: row.source.run_mode,
      status: row.source.status,
      ignore_rules: row.source.ignore_rules ?? '',
      cookie: '',
    })
    setSettingsCredentialTest(null)
    setSettingsCredentialTestError('')
  }

  const testSettingsCookie = async () => {
    if (!setting) return null
    const cookie = String(settingsForm.getFieldValue('cookie') ?? '').trim()
    setTestingSettingsCredential(true)
    setSettingsCredentialTestError('')
    try {
      const result = cookie
        ? await api.testSourceCredential('yike_photos', { cookie })
        : await api.testStoredSourceCredential(setting.source.id)
      setSettingsCredentialTest(result)
      return result
    } catch (error) {
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError(externalSourceCredentialTestErrorLabel(error instanceof Error ? error.message : String(error)))
      return null
    } finally {
      setTestingSettingsCredential(false)
    }
  }

  const saveSettings = async (values: SourceSettingsValues) => {
    if (!setting) return
    setSavingSettings(true)
    const pendingCookie = values.cookie?.trim() ?? ''
    if (externalSourceConnectorProfile(setting.source.kind).credential === 'cookie' && pendingCookie) {
      const tested = await testSettingsCookie()
      if (!tested) {
        setSavingSettings(false)
        return
      }
    }
    try {
      await api.updateSource(setting.source.id, setting.source.revision, {
        name: values.name.trim(),
        run_mode: values.run_mode,
        status: values.status,
        ignore_rules: values.ignore_rules ?? '',
      })
      if (externalSourceConnectorProfile(setting.source.kind).credential === 'cookie' && pendingCookie) {
        await api.setSourceCredential(setting.source.id, { cookie: pendingCookie })
      }
      message.success('来源设置已保存')
      setSetting(null)
      settingsForm.resetFields()
      await load()
    } catch (error) {
      onError(error)
      await load()
    } finally {
      setSavingSettings(false)
    }
  }

  const clearCookie = async () => {
    if (!setting) return
    try {
      await api.deleteSourceCredential(setting.source.id)
      message.success('Cookie 已清除')
      setSetting({
        ...setting,
        credential: { configured: false },
      })
      await load()
    } catch (error) {
      onError(error)
    }
  }

  const deleteSource = async () => {
    if (!deleteTarget) return
    const row = deleteTarget
    setDeletingSourceID(row.source.id)
    try {
      await api.deleteSource(row.source.id, row.source.revision)
      message.success('来源已删除；已同步到 xDrive 的文件已保留')
      if (selected?.source.id === row.source.id) setSelected(null)
      if (setting?.source.id === row.source.id) {
        setSetting(null)
        settingsForm.resetFields()
      }
      setDeleteTarget(null)
      await load()
    } catch (error) {
      onError(error)
      await load()
    } finally {
      setDeletingSourceID(null)
    }
  }

  const selectedDetail = selected ? externalSourceDetailView(selected) : null
  const selectedRunDetail = selected?.latestRun ? externalSourceRunDetailView(selected.latestRun) : null

  return (
    <>
      <Modal title="外部来源" open={open} onCancel={onClose} footer={null} width={760}>
      <div className="external-sources-toolbar">
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加来源</Button>
        </Space>
      </div>
      <Spin spinning={loading && rows.length === 0}>
        {rows.length === 0 && !loading ? (
          <Empty className="external-source-empty" description="尚未添加外部来源" />
        ) : (
          <div className="external-source-list">
            {rows.map((row) => {
              const card = externalSourceCardView(row)
              const stats = card.scannedItems === undefined || card.scannedBytes === undefined
                ? '尚无扫描统计'
                : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatSize(card.scannedBytes)}`

              return (
                <Card key={row.source.id} size="small" className="external-source-card">
                  <div className="external-source-card-header">
                    <div>
                      <Typography.Title level={4} style={{ margin: 0 }}>{row.source.name}</Typography.Title>
                      <div className="external-source-subtitle">{card.modeLabel}</div>
                    </div>
                    <Badge status={sourceBadgeStatus(card.state.tone)} text={card.state.label} />
                  </div>
                  <div className="external-source-time">{card.lastActivityLabel}：{formatExternalSourceTime(card.lastActivityAt)}</div>
                  <div className="external-source-card-meta">
                    <div className="external-source-stats">{stats}</div>
                    {row.source.last_error && (
                      <Space size={4}>
                        <Typography.Text type="danger" ellipsis={{ tooltip: row.source.last_error }} style={{ maxWidth: 360 }}>
                          {row.source.last_error}
                        </Typography.Text>
                      </Space>
                    )}
                  </div>
                  <div className="external-source-actions">
                    <Space size="small">
                      <Button size="small" onClick={() => setSelected(row)}>查看</Button>
                      {row.source.kind === 'synology_photos' && (
                        <MuiButton
                          size="small"
                          variant="outlined"
                          onClick={() => openSynologyGuide(row.source)}
                          sx={{ minWidth: 'auto', px: 1.25, py: 0.25, fontSize: 12 }}
                        >
                          DSM 配置
                        </MuiButton>
                      )}
                      <Tooltip title={card.trigger.label}>
                        <Button
                          size="small"
                          disabled={!card.trigger.ready}
                          loading={triggeringSourceID === row.source.id}
                          onClick={() => void triggerNow(row)}
                        >
                          {row.source.run_requested_at ? '已请求' : '立即扫描'}
                        </Button>
                      </Tooltip>
                      <Button size="small" onClick={() => openSettings(row)}>设置</Button>
                    </Space>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Spin>
      </Modal>

      <Modal
        title={selected ? `${selected.source.name} · 来源详情` : '来源详情'}
        open={!!selected}
        onCancel={() => setSelected(null)}
        footer={null}
        width={720}
      >
        {selected && selectedDetail && (
          <>
            {selectedDetail.error && (
              <Alert
                type="error"
                showIcon
                message="最近一次运行异常"
                description={selectedDetail.error}
                style={{ marginBottom: 16 }}
              />
            )}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="来源类型">{selectedDetail.kindLabel}</Descriptions.Item>
              <Descriptions.Item label="工作方式">{selectedDetail.modeLabel}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge status={sourceBadgeStatus(selectedDetail.state.tone)} text={selectedDetail.state.label} />
              </Descriptions.Item>
              <Descriptions.Item label="目标目录">
                {selectedDetail.targetNodeID ? `节点 #${selectedDetail.targetNodeID}` : '未配置'}
              </Descriptions.Item>
              <Descriptions.Item label="上次运行">{formatExternalSourceTime(selectedDetail.lastRunAt)}</Descriptions.Item>
              <Descriptions.Item label="上次成功">{formatExternalSourceTime(selectedDetail.lastSuccessAt)}</Descriptions.Item>
              {selectedDetail.credential && (
                <Descriptions.Item label={selectedDetail.credential.label}>
                  {selectedDetail.credential.configured ? '已配置' : '未配置'}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider orientation="left">最近一次运行</Divider>
            {selectedRunDetail ? (
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="运行状态">{selectedRunDetail.statusLabel}</Descriptions.Item>
                <Descriptions.Item label="开始时间">{formatExternalSourceTime(selectedRunDetail.startedAt)}</Descriptions.Item>
                {selectedRunDetail.metrics.map((metric) => (
                  <Descriptions.Item key={metric.key} label={metric.label}>
                    {metric.items.toLocaleString('zh-CN')} 项
                    {metric.bytes === undefined ? '' : ` · ${formatSize(metric.bytes)}`}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无运行记录" />
            )}
          </>
        )}
      </Modal>

      <Modal
        title="添加外部来源"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false)
          createForm.resetFields()
        }}
        footer={null}
        width={640}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message="目标目录使用当前文件夹"
          description={`当前目标：${defaultTargetLabel}${defaultTargetPath ? `（${defaultTargetPath}）` : '（我的文件根目录）'}`}
          style={{ marginBottom: 16 }}
        />
        <Form form={createForm} layout="vertical" onFinish={createSource} requiredMark={false}>
          <Form.Item name="kind" label="来源类型" rules={[{ required: true }]}>
            <Select
              onChange={changeCreateKind}
              options={[
                { value: 'synology_photos', label: '群晖 Photos' },
                { value: 'yike_photos', label: '一刻相册' },
              ]}
            />
          </Form.Item>
          <Form.Item name="name" label="来源名称" rules={[{ required: true, whitespace: true, max: 128 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="run_mode" label="初始运行模式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'scan', label: '仅扫描（推荐先使用）' },
                { value: 'sync', label: '同步' },
              ]}
            />
          </Form.Item>
          <Form.Item name="ignore_rules" label="忽略规则">
            <Input.TextArea rows={5} placeholder="每行一条 gitignore 风格规则" />
          </Form.Item>
          {createKind === 'yike_photos' && (
            <Form.Item
              name="cookie"
              label="一刻相册 Cookie"
              rules={[{ required: true, whitespace: true, message: '请填写一刻相册 Cookie' }]}
              extra="Cookie 只会加密保存到服务器，之后不会回传到浏览器。"
            >
              <Input.Password
                autoComplete="off"
                onChange={() => {
                  setCreateCredentialTest(null)
                  setCreateCredentialTestError('')
                }}
              />
            </Form.Item>
          )}
          {createKind === 'yike_photos' && (
            <div style={{ marginTop: -12, marginBottom: 16 }}>
              <MuiButton size="small" variant="outlined" disabled={testingCreateCredential} onClick={() => void testCreateCookie()}>
                {testingCreateCredential ? '正在测试…' : '测试连接'}
              </MuiButton>
              {createCredentialTest && (
                <MuiAlert severity="success" sx={{ mt: 1 }}>
                  {externalSourceCredentialTestSuccessLabel(createCredentialTest)}
                </MuiAlert>
              )}
              {createCredentialTestError && <MuiAlert severity="error" sx={{ mt: 1 }}>{createCredentialTestError}</MuiAlert>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setCreateOpen(false); createForm.resetFields() }}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={creating}
            >
              添加来源
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        title={setting ? `${setting.source.name} · 设置` : '来源设置'}
        open={!!setting}
        onCancel={() => {
          setSetting(null)
          settingsForm.resetFields()
        }}
        footer={null}
        width={640}
        destroyOnClose
      >
        {setting && (
          <Form form={settingsForm} layout="vertical" onFinish={saveSettings} requiredMark={false}>
            <Form.Item
              name="name"
              label="来源名称"
              rules={[{ required: true, whitespace: true, max: 128 }]}
            >
              <Input autoFocus />
            </Form.Item>
            <Form.Item name="run_mode" label="运行模式" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'sync', label: '同步' },
                  { value: 'scan', label: '仅扫描' },
                ]}
              />
            </Form.Item>
            <Form.Item name="status" label="来源状态" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'paused', label: '暂停' },
                ]}
              />
            </Form.Item>
            <Form.Item name="ignore_rules" label="忽略规则">
              <Input.TextArea
                rows={6}
                placeholder={'每行一条规则，例如：\n@eaDir/\n*.tmp\n!important.jpg'}
              />
            </Form.Item>

            {externalSourceConnectorProfile(setting.source.kind).credential === 'cookie' && (
              <>
                <Divider orientation="left">一刻相册凭据</Divider>
                <Alert
                  type={setting.credential?.configured ? 'success' : 'warning'}
                  showIcon
                  message={setting.credential?.configured ? 'Cookie 已配置' : 'Cookie 未配置'}
                  description="出于安全原因，已保存的 Cookie 不会从服务器读取回浏览器。"
                  style={{ marginBottom: 16 }}
                />
                <Form.Item name="cookie" label="更新 Cookie">
                  <Input.Password
                    autoComplete="off"
                    placeholder="留空则保持当前 Cookie 不变"
                    onChange={() => {
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                </Form.Item>
                <div style={{ marginTop: -12, marginBottom: 16 }}>
                  <MuiButton
                    size="small"
                    variant="outlined"
                    disabled={testingSettingsCredential}
                    onClick={() => void testSettingsCookie()}
                  >
                    {testingSettingsCredential ? '正在测试…' : '测试连接'}
                  </MuiButton>
                  {settingsCredentialTest && (
                    <MuiAlert severity="success" sx={{ mt: 1 }}>
                      {externalSourceCredentialTestSuccessLabel(settingsCredentialTest)}
                    </MuiAlert>
                  )}
                  {settingsCredentialTestError && <MuiAlert severity="error" sx={{ mt: 1 }}>{settingsCredentialTestError}</MuiAlert>}
                </div>
                {setting.credential?.configured && (
                  <Popconfirm
                    title="清除已保存的 Cookie？"
                    description="清除后，一刻相册来源将无法继续扫描或同步，直到重新配置 Cookie。"
                    okText="清除"
                    cancelText="取消"
                    onConfirm={() => void clearCookie()}
                  >
                    <Button danger style={{ marginBottom: 16 }}>清除 Cookie</Button>
                  </Popconfirm>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <MuiButton
                type="button"
                color="error"
                variant="outlined"
                disabled={savingSettings || setting.latestRun?.status === 'running'}
                onClick={() => setDeleteTarget(setting)}
              >
                删除来源
              </MuiButton>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  onClick={() => {
                    setSetting(null)
                    settingsForm.resetFields()
                  }}
                >
                  取消
                </Button>
                <Button type="primary" htmlType="submit" loading={savingSettings}>保存设置</Button>
              </div>
            </div>
          </Form>
        )}
      </Modal>

      <Dialog open={!!deleteTarget} onClose={() => deletingSourceID === null && setDeleteTarget(null)}>
        <DialogTitle>删除外部来源？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            删除“{deleteTarget?.source.name ?? ''}”只会移除同步配置、运行记录、来源映射和已保存凭据。
            已经同步到 xDrive 的文件会保留，不会删除。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton disabled={deletingSourceID !== null} onClick={() => setDeleteTarget(null)}>取消</MuiButton>
          <MuiButton color="error" variant="contained" disabled={deletingSourceID !== null} onClick={() => void deleteSource()}>
            {deletingSourceID === null ? '删除来源' : '正在删除…'}
          </MuiButton>
        </DialogActions>
      </Dialog>

      <SynologyDsmGuideDialog
        open={!!guideSource}
        source={guideSource}
        serverURL={window.location.origin}
        username={guideUsername}
        onClose={() => setGuideSource(null)}
      />
    </>
  )
}
