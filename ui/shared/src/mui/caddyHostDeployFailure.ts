import type { XDriveCaddyDeployState } from '../service-dependencies'

// Only display descriptions of fixed, Server-allowlisted Host Control codes.
// Never include raw errors, filesystem paths, provider messages or log text.
export function caddyHostDeployFailureMessage(
  receipt: Pick<XDriveCaddyDeployState, 'error' | 'rolled_back'>,
): string {
  switch (receipt.error) {
    case 'installer-busy':
      return '服务端正在升级，Caddy 未被重建；配置仍待部署，升级结束后请重新检测。'
    case 'deploy-refused':
      return '宿主机拒绝部署：配置已变化或恢复记录不完整。请重新读取配置，不要直接重复提交。'
    case 'interrupted-deploy':
      return receipt.rolled_back
        ? 'Caddy 部署中断，旧配置与本机入口已恢复验证；请重新检测。'
        : 'Caddy 部署中断，原网关恢复未确认；请先检查宿主机。'
    case 'caddy-deploy-or-verify-failed':
      return receipt.rolled_back
        ? 'Caddy 重建或本机 TLS 验证失败；已验证恢复旧网关，请重新检测。'
        : 'Caddy 重建或本机 TLS 验证失败；旧网关恢复未确认，请检查宿主机。'
    default:
      return 'Caddy 部署失败，原因尚未确认；请检查宿主机状态，不要盲目重试。'
  }
}
