import { useCallback, useEffect, useState } from 'react'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, Card, Descriptions, Divider, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Typography, message } from 'antd'
import type { BadgeProps } from 'antd'
import type {
  ExternalSource,
  ExternalSourceCredentialStatus,
  ExternalSourceRun,
  XDriveApi,
} from './api'
import { formatSize } from '../../ui/shared/src'

type SourceRow = {
  source: ExternalSource
  latestRun?: ExternalSourceRun
  credential?: ExternalSourceCredentialStatus
}

type SourceSettingsValues = {
  name: string
  run_mode: 'scan' | 'sync'
  status: 'active' | 'paused'
  ignore_rules?: string
  cookie?: string
}
type CreateSourceValues = {
  kind: 'synology_photos' | 'yike_photos'
  name: string
  run_mode: 'scan' | 'sync'
  ignore_rules?: string
  cookie?: string
}


function sourceStatus(row: SourceRow): { status: BadgeProps['status']; text: string } {
  const { source, latestRun, credential } = row
  if (source.status === 'paused') return { status: 'default', text: '已暂停' }
  if (latestRun?.status === 'running') return { status: 'processing', text: '运行中' }
  if (source.last_error) return { status: 'error', text: '异常' }
  if (source.kind === 'yike_photos') {
    return credential?.configured
      ? { status: 'success', text: 'Cookie 已配置' }
      : { status: 'warning', text: 'Cookie 未配置' }
  }
  if (source.last_success_at) return { status: 'success', text: '正常' }
  if (latestRun?.status === 'partial') return { status: 'warning', text: '部分完成' }
  return { status: 'default', text: '尚未运行' }
}

function formatRunTime(value?: string) {
  if (!value) return '尚无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚无记录'

  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((day.getTime() - targetDay.getTime()) / 86_400_000)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (diffDays === 0) return `今天 ${time}`
  if (diffDays === 1) return `昨天 ${time}`
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function sourceMode(source: ExternalSource) {
  const direction = source.direction === 'push' ? 'Push' : 'Pull'
  const mode = source.run_mode === 'scan' ? '仅扫描' : '同步'
  return `${direction} · ${mode}`
}

function sourceKind(kind: string) {
  if (kind === 'synology_photos') return '群晖 Photos'
  if (kind === 'yike_photos') return '一刻相册'
  return kind
}
function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}


function runStatusLabel(status: ExternalSourceRun['status']) {
  const labels: Record<ExternalSourceRun['status'], string> = {
    running: '运行中',
    completed: '已完成',
    partial: '部分完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status]
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
  const [rows, setRows] = useState<SourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SourceRow | null>(null)
  const [setting, setSetting] = useState<SourceRow | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm] = Form.useForm<SourceSettingsValues>()
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<CreateSourceValues>()
  const createKind = Form.useWatch('kind', createForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sources = await api.sources()
      const next = await Promise.all(sources.map(async (source) => {
        const [runs, credential] = await Promise.all([
          api.sourceRuns(source.id, 1),
          source.kind === 'yike_photos'
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
  const openCreate = () => {
    createForm.setFieldsValue({
      kind: 'synology_photos',
      name: '群晖 Photos',
      run_mode: 'scan',
      ignore_rules: '@eaDir/\n\\#recycle/\n',
      cookie: '',
    })
    setCreateOpen(true)
  }

  const changeCreateKind = (kind: CreateSourceValues['kind']) => {
    createForm.setFieldsValue(kind === 'synology_photos'
      ? { name: '群晖 Photos', ignore_rules: '@eaDir/\n\\#recycle/\n', cookie: '' }
      : { name: '一刻相册', ignore_rules: '', cookie: '' })
  }

  const createSource = async (values: CreateSourceValues) => {
    if (!defaultTargetNodeID) {
      message.error('当前目标文件夹尚未加载，请稍后重试')
      return
    }
    if (values.kind === 'synology_photos' && !defaultTargetPath) {
      message.error('群晖来源不能直接使用“我的文件”根目录，请先进入一个目标文件夹')
      return
    }
    const cookie = values.cookie?.trim() ?? ''
    if (values.kind === 'yike_photos' && !cookie) {
      message.error('请填写一刻相册 Cookie')
      return
    }

    setCreating(true)
    let created: ExternalSource
    try {
      created = await api.createSource({
        name: values.name.trim(),
        kind: values.kind,
        direction: values.kind === 'synology_photos' ? 'push' : 'pull',
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

    if (values.kind === 'yike_photos') {
      try {
        await api.setSourceCredential(created.id, { cookie })
      } catch (error) {
        onError(error)
        message.warning('来源已创建，但 Cookie 保存失败；请在“设置”中重新配置')
      }
    }

    message.success('外部来源已添加')
    setCreateOpen(false)
    createForm.resetFields()
    await load()
    setCreating(false)

    if (values.kind === 'synology_photos') {
      const command =
        'xdrive-source-agent setup --name ' + shellQuote(created.name) +
        ' --target ' + shellQuote(defaultTargetPath) +
        ' --personal /volume1/homes/USERNAME/Photos --mode ' + created.run_mode
      Modal.info({
        title: '群晖来源已添加',
        width: 720,
        content: (
          <div style={{ marginTop: 16 }}>
            <Alert
              type="success"
              showIcon
              message="xDrive Source 已创建"
              description="下一步在群晖 DSM 上配置 xdrive-source-agent。Agent 会按相同来源名称复用这个 Source，不会重复创建。"
              style={{ marginBottom: 16 }}
            />
            <Typography.Paragraph>
              将命令中的 <Typography.Text code>USERNAME</Typography.Text> 替换为 DSM 用户名：
            </Typography.Paragraph>
            <Typography.Paragraph code copyable={{ text: command }}>{command}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">
              如需同时扫描共享空间，在命令后追加 <Typography.Text code>--shared /volume1/photo</Typography.Text>。
            </Typography.Paragraph>
          </div>
        ),
      })
    }
  }


  const openSettings = (row: SourceRow) => {
    setSetting(row)
    settingsForm.setFieldsValue({
      name: row.source.name,
      run_mode: row.source.run_mode,
      status: row.source.status,
      ignore_rules: row.source.ignore_rules ?? '',
      cookie: '',
    })
  }

  const saveSettings = async (values: SourceSettingsValues) => {
    if (!setting) return
    setSavingSettings(true)
    try {
      await api.updateSource(setting.source.id, setting.source.revision, {
        name: values.name.trim(),
        run_mode: values.run_mode,
        status: values.status,
        ignore_rules: values.ignore_rules ?? '',
      })
      if (setting.source.kind === 'yike_photos' && values.cookie?.trim()) {
        await api.setSourceCredential(setting.source.id, { cookie: values.cookie.trim() })
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

  const selectedState = selected ? sourceStatus(selected) : null

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
              const state = sourceStatus(row)
              const timeLabel = row.source.run_mode === 'scan' ? '上次扫描' : '上次成功'
              const timeValue = row.source.run_mode === 'scan'
                ? row.source.last_run_at
                : row.source.last_success_at
              const stats = row.latestRun
                ? `${row.latestRun.scanned_items.toLocaleString('zh-CN')} 项 · ${formatSize(row.latestRun.scanned_bytes)}`
                : '尚无扫描统计'

              return (
                <Card key={row.source.id} size="small" className="external-source-card">
                  <div className="external-source-card-header">
                    <div>
                      <Typography.Title level={4} style={{ margin: 0 }}>{row.source.name}</Typography.Title>
                      <div className="external-source-subtitle">{sourceMode(row.source)}</div>
                    </div>
                    <Badge status={state.status} text={state.text} />
                  </div>
                  <div className="external-source-time">{timeLabel}：{formatRunTime(timeValue)}</div>
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
        {selected && selectedState && (
          <>
            {selected.source.last_error && (
              <Alert
                type="error"
                showIcon
                message="最近一次运行异常"
                description={selected.source.last_error}
                style={{ marginBottom: 16 }}
              />
            )}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="来源类型">{sourceKind(selected.source.kind)}</Descriptions.Item>
              <Descriptions.Item label="工作方式">{sourceMode(selected.source)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge status={selectedState.status} text={selectedState.text} />
              </Descriptions.Item>
              <Descriptions.Item label="目标目录">
                {selected.source.target_node_id ? `节点 #${selected.source.target_node_id}` : '未配置'}
              </Descriptions.Item>
              <Descriptions.Item label="上次运行">{formatRunTime(selected.source.last_run_at)}</Descriptions.Item>
              <Descriptions.Item label="上次成功">{formatRunTime(selected.source.last_success_at)}</Descriptions.Item>
              {selected.source.kind === 'yike_photos' && (
                <Descriptions.Item label="Cookie">
                  {selected.credential?.configured ? '已配置' : '未配置'}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider orientation="left">最近一次运行</Divider>
            {selected.latestRun ? (
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="运行状态">{runStatusLabel(selected.latestRun.status)}</Descriptions.Item>
                <Descriptions.Item label="开始时间">{formatRunTime(selected.latestRun.started_at)}</Descriptions.Item>
                <Descriptions.Item label="扫描">
                  {selected.latestRun.scanned_items.toLocaleString('zh-CN')} 项 · {formatSize(selected.latestRun.scanned_bytes)}
                </Descriptions.Item>
                <Descriptions.Item label="计划传输">
                  {selected.latestRun.planned_transfer_items.toLocaleString('zh-CN')} 项 · {formatSize(selected.latestRun.planned_transfer_bytes)}
                </Descriptions.Item>
                <Descriptions.Item label="新增">{selected.latestRun.new_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="变更">{selected.latestRun.changed_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="移动">{selected.latestRun.moved_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="缺失">{selected.latestRun.missing_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="实际传输">
                  {selected.latestRun.transferred_items.toLocaleString('zh-CN')} 项 · {formatSize(selected.latestRun.transferred_bytes)}
                </Descriptions.Item>
                <Descriptions.Item label="失败">{selected.latestRun.failed_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
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
          {createKind === 'synology_photos' && !defaultTargetPath && (
            <Alert
              type="warning"
              showIcon
              message="请先进入一个目标文件夹"
              description="群晖 DSM setup 需要根目录下的相对目标路径，因此不能直接绑定“我的文件”根目录。"
              style={{ marginBottom: 16 }}
            />
          )}
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
              <Input.Password autoComplete="off" />
            </Form.Item>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setCreateOpen(false); createForm.resetFields() }}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={creating}
              disabled={createKind === 'synology_photos' && !defaultTargetPath}
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

            {setting.source.kind === 'yike_photos' && (
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
                  />
                </Form.Item>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
          </Form>
        )}
      </Modal>
    </>
  )
}
