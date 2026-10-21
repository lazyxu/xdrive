# SD-UI-V1.1 P0-SAVE-A · HTTPS + AliDNS 原子目标保存 API

2026-10-21 · 服务端第一阶段。实施基线：已合入的 docs/system-dependencies-ui-v1-https-8443.md v1.1，六项决定不变。本 PR **仅补齐服务端的单事务双修订保存能力**；共享 MUI 的一次保存按钮、Desktop Agent/Client IPC 接线将在独立 PR 中完成。

## 新接口（严格管理员权限）

PUT /api/v1/admin/services/caddy/config

Request（HTTPS 与 alidns 至少一个对象必须存在；不编辑某组则省略该对象，但两组 expected revision 都必须提供）：

    {
      "https_revision": 2,
      "alidns_revision": 1,
      "https": {
        "enabled": true,
        "domain": "files.example.com",
        "lan_enabled": true,
        "lan_ip": "192.168.10.2"
      },
      "alidns": {
        "action": "replace",
        "access_key_id": "<redacted input>",
        "access_key_secret": "<redacted input>"
      }
    }

- 省略 https 时 HTTPS 修订保持不变；省略 alidns 时 AliDNS 修订保持不变；只请求 action=replace 或 action=clear。禁止空动作、隐式清除和不完整/未知字段。
- 域名必须是原有 ASCII FQDN 校验（规范小写），LAN 是 RFC1918 规范 IPv4，绝不可同时关闭两种 HTTPS 入口。完整 HTTPS 四字段在编辑此组时必填；不编辑组时服务端不从 Host 推断其目标。
- 单 PostgreSQL 事务内锁定 HTTPS setting → AliDNS secret → Host Pending，分别校验**两个期望修订**。独立 Server 副本同样依赖数据库行锁与唯一键 CAS。任何旧修订、待应用 Host 占位、缺密钥环、无效密文、审计错误或数据库错误都不能发生一半保存。
- HTTPS 修订写入原 immutable history，AliDNS 使用原 ConnectorSecrets AEAD 的 Caddy 专用 AAD；明文仅作 Seal 输入并立即清除临时 buffer。审计只有版本、变更标记和操作类型，不包含 AK/SK。响应仅有两组新修订、saved=true、host_applied=false、apply_supported=false，Cache-Control: no-store。
- 旧的 PUT /services/caddy/https 与 PUT /services/caddy/alidns 保持兼容且安全；本新接口不会调用它们的 Handler（避免两次独立事务），也不会访问 Docker、Host、ACME、CA、DNS 或重启 Caddy。实际部署仍须独立按 #2075 实施 Rescue + signed Host Manager + watchdog + 独立验证 + 回滚/Applied Receipt，当前 apply_supported=false。
- UI 的单一「保存配置」接线必须在未来独立 PR 中以**本接口真实可用**和兼容性测试为前提。当前项目 UI 即使变成单页面，原两组分别保存仍不能声称一次提交具备原子性。

## 必须实测

internal/api/admin_caddy_atomic_save_integration_test.go 在 XD_TEST_DATABASE_URL 的真实 PostgreSQL 中隔离 schema，使用两组不同 GORM 连接和两个独立 Server/Router 验证：匿名/普通用户 401/403；双方新修订一次提交；AEAD 密文与正确 AAD；旧 HTTPS/旧 AliDNS 409 且都不改变；只清凭据时 HTTPS 修订不变；两 Server CAS 仅一次成功；Host Pending 409；人为移除测试 schema 内审计表后 503 且两组 DB 变更全回滚。测试不得跳过原有 Caddy 私有 Host reservation、AliDNS、HTTPS 回归，不得从 CI 源码测试宣称真实生产应用成功。

根据 AGENTS.md，只能在最新完整 master 上以一个独立工作提交、保持其他 Owner 的全部代码与历史不变；当前准确 HEAD 完整 Linux/Windows/Go/Web/Desktop/真实 PostgreSQL Race/Host Rootless/制品/Final Gate 绿且 fresh mergeable_state=clean 才允许合入。生产安全验收按用户决定跳过（未验收），不索要生产账户/AK/HAR、不阻塞源码/CI 合并；源码安全测试必须执行。
