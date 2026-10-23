# Caddy 管理第一版：宿主机 .env 单一配置源

**状态：Draft PR #2382，尚未合并 / 尚未发布。** 本文描述当前分支的实际源码能力，不把源码与合入、部署或真实公网 HTTPS 验收混为一谈。

## 用户确认的第一版范围

- Caddy 当前管理配置唯一来源为宿主机 `~/.xd/config/.env`，而非 PostgreSQL Desired。
- 只允许管理员操作四项：`XD_DOMAIN`、`XD_LAN_HTTPS_IP`、`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`。对其他变量（数据库密码、JWT、连接器密钥、路径、镜像）不得修改。
- “读取”通过固定 Host Control 观察取得非密钥字段、AliDNS 是否配置及四字段 SHA256。“保存配置”使用预期 SHA256 的 CAS、0600 原子替换并保存原运行配置到受限宿主目录；**保存不会触发部署**。
- 单独“重新部署 Caddy”：仅运行固定 `docker compose --env-file ... -f ... up -d --no-deps --force-recreate caddy`。不开放泛用 Docker 命令、不提供任意宿主机文件编辑器，也不重启 Server/PostgreSQL/Worker。
- 发布成功仅要求固定本机 Caddy HTTP Ready 与启用的域名/私网 IP 本机可信 TLS 验证；不等于公网可达或客户端 CA 信任完成。失败则尝试恢复上次宿主配置并单独重建旧 Caddy；升级器的安装锁占用时拒绝操作而不是错误回退。
- 原 Host Control 操作中断后，新的 Runner 只对原 `deploy` 任务执行受限旧配置恢复；没有足够物理证明时保持状态不确定及阻断新写入。
- AliDNS 密钥默认不进入普通 GET/状态/log；管理员明确点击密码框眼睛时，使用固定 Host-only reveal、当前四字段 SHA CAS、私有一次性回执和客户端至多 30 秒显示周期。
- PostgreSQL 继续服务原有用户和管理员认证；**本版不增加或修改 Caddy PostgreSQL 历史表、配置事务或回退记录**。数据库历史版本与修改审计推迟第二版。旧 PostgreSQL Caddy 控制接口仅用于测试/旧版兼容，实际生产 Host 模式不再让它修改当前配置。

## 不可混淆的配置状态

1. `.env` 已保存：仅磁盘配置更新，仍可能尚未重建 Caddy。
2. Caddy 本机入口已验证：当前主机上已通过指定健康和 TLS 探针。
3. 公网域名可达、真实 DNS/ACME 和终端信任：本机验证无法替代这些证据，不得自动标记成功。

升级安装器也会读取 `.env` 并重新创建 Caddy，因此在“保存配置”与“重新部署”之间发生升级时，新配置可能被升级流程应用；UI 不得把待部署标记等同于确切运行代次。

## 代码与离线回归

- `scripts/caddy-env-config.py`：限定 JSON、四字段值检查、CAS、0600/0700 fsync+rename、私有原始备份、主动恢复、读取和一次性 AliDNS reveal。
- `scripts/server-control.sh`：受限 Host 队列、Docker recreate、健康与 TLS、安装锁互斥、失败/中断恢复与固定状态回执。
- `internal/api/admin_caddy_env_only.go`、`admin_caddy_host_env.go`、`admin_caddy_host_deploy.go`：管理员受限读/写/部署/状态/揭示；生产 Server 标记 `CaddyHostEnvAuthoritative`。
- Web/Mobile 复用共享 `CaddyDetailV1`；Desktop 经 Electron Main、Preload、Agent 到 Server，旧 Agent 不允许静默落回分段保存。
- 运行：`python3 scripts/test-caddy-env-config.py`、`bash scripts/test-caddy-env-deploy.sh`；脚本纳入现有 Host validation。另有 Go 无 PostgreSQL Host 读取/部署防误操作测试。

## 尚需确认

准确 PR HEAD 的全量 Go Linux/Windows、PostgreSQL API Race（整仓兼容验证）、Web/Desktop、Host/Rootless、制品与 Final Gate 均通过后，才能将 Draft 改为 Ready、合并并清理分支。运行中的真实公网/生产域名/凭据不作伪验证。真实生产环境专属安全验收：**按用户决定跳过（未验收）**；代码权限和安全测试必须通过。
