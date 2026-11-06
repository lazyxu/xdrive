export type SynologyDsmGuideVisual =
  | 'task-create'
  | 'task-schedule'
  | 'task-script'

export interface SynologyDsmGuideStep {
  id: string
  title: string
  summary: string
  details?: string[]
  command?: string
  visual?: SynologyDsmGuideVisual
}

export interface SynologyDsmGuide {
  title: string
  subtitle: string
  sourceID?: number
  sourceName: string
  steps: SynologyDsmGuideStep[]
}

export interface SynologyDsmGuideInput {
  sourceID?: number
  sourceName: string
  runMode?: 'scan' | 'sync'
  serverURL?: string
  xdriveUsername?: string
}

function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function synologyDsmSetupGuide(input: SynologyDsmGuideInput): SynologyDsmGuide {
  const server = input.serverURL?.trim() || 'https://drive.example.com'
  const username = input.xdriveUsername?.trim() || 'XDRIVE_USERNAME'
  const agent = '/volume1/tools/xdrive-source-agent'
  const configExport = 'export XD_SOURCE_AGENT_CONFIG_DIR="$HOME/.config/xdrive-source-agent"'

  const loginCommand = [
    configExport,
    "export XD_PASSWORD='你的 xDrive 密码'",
    `${agent} login --server ${shellQuote(server)} --username ${shellQuote(username)}`,
  ].join('\n')

  const setupCommand = [
    configExport,
    `${agent} setup ${input.sourceID ? `--source-id ${input.sourceID}` : `--name ${shellQuote(input.sourceName)} --mode ${input.runMode ?? 'scan'}`} \\`,
    "  --personal '/volume1/homes/DSM_USERNAME/Photos' \\",
    "  --shared '/volume1/photo'",
  ].join('\n')

  const schedulerCommand = [
    configExport,
    `${agent} run --due --interval 6h >> "$HOME/.config/xdrive-source-agent/task.log" 2>&1`,
  ].join('\n')

  const verifyCommand = [
    configExport,
    `${agent} status`,
    `${agent} run`,
  ].join('\n')

  return {
    title: '群晖 DSM 配置 xdrive-source-agent',
    subtitle: input.sourceID
      ? `绑定同步文件夹 #${input.sourceID} · ${input.sourceName}`
      : `在 NAS 注册设备并创建新来源 · ${input.sourceName}`,
    ...(input.sourceID ? { sourceID: input.sourceID } : {}),
    sourceName: input.sourceName,
    steps: [
      {
        id: 'install',
        title: '1. 安装 source-agent',
        summary: '先确认 NAS 架构，再把对应二进制放到固定路径。',
        details: [
          'x86_64 使用 amd64；aarch64 / arm64 使用 arm64；armv7l 使用 armv7 Source Agent。',
          '登录、setup 与计划任务应使用同一个 DSM 用户，配置保存在该用户的 HOME 下。',
        ],
        command: [
          'uname -m',
          'mkdir -p /volume1/tools "$HOME/.config/xdrive-source-agent"',
          'chmod 700 "$HOME/.config/xdrive-source-agent"',
          '# 将对应架构的二进制复制为：/volume1/tools/xdrive-source-agent',
          'chmod 0755 /volume1/tools/xdrive-source-agent',
          '/volume1/tools/xdrive-source-agent version',
        ].join('\n'),
      },
      {
        id: 'login',
        title: '2. 登录 xDrive',
        summary: '通过 DSM SSH/终端执行一次登录，凭据会写入 source-agent 的私有凭据存储。',
        details: ['XD_PASSWORD 只用于本次登录，不要写入 Task Scheduler。'],
        command: loginCommand,
      },
      {
        id: 'bind',
        title: '3. 绑定这个同步文件夹',
        summary: input.sourceID
          ? '用现有 Source ID 复核 Device/Root 绑定；已分配的目标目录保持不变。'
          : '由 NAS 注册 DSM Device 并创建新 Source，服务器自动分配目标，浏览器不传递 Device Token。',
        details: [
          '把 DSM_USERNAME 替换为实际 DSM 用户名。',
          '不使用个人空间时删除 --personal；不使用共享空间时删除 --shared。',
          '新来源创建后刷新 Source Manager，再设置计划和忽略规则。',
        ],
        command: setupCommand,
      },
      {
        id: 'task-create',
        title: '4. 新建 DSM 计划任务',
        summary: '控制面板 → 任务计划 → 新增 → 计划的任务 → 用户定义的脚本。',
        details: [
          '任务名称建议：xDrive Synology Photos。',
          '运行用户必须对配置的 Photos 根目录有读取权限；不需要源端写权限。',
        ],
        visual: 'task-create',
      },
      {
        id: 'task-schedule',
        title: '5. 设置每分钟检查',
        summary: '把计划设为每天执行，并每 1 分钟重复一次。',
        details: [
          '每分钟只做轻量到期/手动请求检查，不会每分钟全盘扫描。',
          '运行用户必须与登录/setup 一致，且拥有配置的 Photos 根目录的只读权限。',
          '真实扫描间隔以 Source 的计划为准；“立即扫描”请求会由下一次到期检查消费。',
        ],
        visual: 'task-schedule',
      },
      {
        id: 'task-script',
        title: '6. 填写任务脚本',
        summary: '在“任务设置 / 用户定义的脚本”里粘贴下面两行。',
        command: schedulerCommand,
        visual: 'task-script',
      },
      {
        id: 'verify',
        title: '7. 验证配置',
        summary: '先看状态，再手动执行一次扫描；确认无误后即可依赖计划任务。',
        command: verifyCommand,
      },
    ],
  }
}
