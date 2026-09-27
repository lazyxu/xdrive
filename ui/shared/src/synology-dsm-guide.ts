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
  sourceID: number
  sourceName: string
  steps: SynologyDsmGuideStep[]
}

export interface SynologyDsmGuideInput {
  sourceID: number
  sourceName: string
  serverURL?: string
  xdriveUsername?: string
}

function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function synologyDsmSetupGuide(input: SynologyDsmGuideInput): SynologyDsmGuide {
  const server = input.serverURL?.trim() || 'https://drive.example.com'
  const username = input.xdriveUsername?.trim() || 'XDRIVE_USERNAME'
  const configDir = '/volume1/@appdata/xdrive-source-agent'
  const agent = '/volume1/tools/xdrive-source-agent'

  const loginCommand = [
    `export XD_SOURCE_AGENT_CONFIG_DIR=${shellQuote(configDir)}`,
    "export XD_PASSWORD='你的 xDrive 密码'",
    `${agent} login --server ${shellQuote(server)} --username ${shellQuote(username)}`,
  ].join('\n')

  const setupCommand = [
    `export XD_SOURCE_AGENT_CONFIG_DIR=${shellQuote(configDir)}`,
    `${agent} setup --source-id ${input.sourceID} \\`,
    "  --personal '/volume1/homes/DSM_USERNAME/Photos' \\",
    "  --shared '/volume1/photo'",
  ].join('\n')

  const schedulerCommand = [
    `export XD_SOURCE_AGENT_CONFIG_DIR=${configDir}`,
    `${agent} run --due --interval 6h >> ${configDir}/task.log 2>&1`,
  ].join('\n')

  const verifyCommand = [
    `export XD_SOURCE_AGENT_CONFIG_DIR=${shellQuote(configDir)}`,
    `${agent} status`,
    `${agent} run`,
  ].join('\n')

  return {
    title: '群晖 DSM 配置 xdrive-source-agent',
    subtitle: `绑定 Source #${input.sourceID} · ${input.sourceName}`,
    sourceID: input.sourceID,
    sourceName: input.sourceName,
    steps: [
      {
        id: 'install',
        title: '1. 安装 source-agent',
        summary: '先确认 NAS 架构，再把对应二进制放到固定路径。',
        details: [
          'x86_64 使用 xdrive-source-agent-linux-amd64；aarch64 / arm64 使用 xdrive-source-agent-linux-arm64。',
          '建议把配置目录固定为 /volume1/@appdata/xdrive-source-agent。',
        ],
        command: [
          'uname -m',
          'mkdir -p /volume1/tools /volume1/@appdata/xdrive-source-agent',
          'chmod 700 /volume1/@appdata/xdrive-source-agent',
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
        title: '3. 绑定这个 Source',
        summary: '使用 Source ID 精确绑定，不再依赖同名匹配；目标目录和当前运行模式默认保留。',
        details: [
          '把 DSM_USERNAME 替换为实际 DSM 用户名。',
          '不使用个人空间时删除 --personal；不使用共享空间时删除 --shared。',
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
          '默认真实扫描间隔仍由 --interval 6h 控制；UI 的“立即扫描”会覆盖这个间隔。',
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
