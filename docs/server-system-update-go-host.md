# 系统更新：Go Host 执行器与受限导入 ID

> 设计确认：2026-11-03，1A 2A 3C 4B 5A；服务端命令行与管理 UI 共用底层更新事务。此分支是 **G0 Go 核心之上的 Draft 集成层**，并非已发布的离线 GUI 更新。

## CLI 与 Host Control 等价

在线路径仍为 `xdrive-server update --source github|gitlab|xdrive --channel master|stable`，由宿主机 `install-server.sh` 完成备份、镜像替换、健康检查及回滚；其中 Share 路径继续保持已签名的旧发布物兼容。

离线 Host 已增加受限入口：

```sh
xdrive-server update --source offline --channel master \
  --offline-id 0123456789abcdef0123456789abcdef \
  --trusted-manifest-sha256 "$MANIFEST_SHA256_FROM_INDEPENDENT_CHANNEL" \
  --trusted-installer-sha256 "$GO_ELF_SHA256_FROM_INDEPENDENT_CHANNEL"
```

- `offline-id` 必须恰好 32 位小写十六进制；只能解析 `~/.xd/state/update-imports/<offline-id>`，不能在 Web/API 中传任意路径、环境变量或可执行命令。
- 目录内必须有 `manifest.json`、`xdrive-offline-linux-amd64`、Manifest 指定的组件包。若 Host 配置本地可信根，还必须存在 `delivery.json` 和 `delivery-attestation.jsonl`，由 Host 验证三个签名主体；CLI 可省略手工 SHA，或提供它们做交叉校验。没有可信根时，必须提供独立可信渠道获得的 Manifest/Go ELF 双 SHA。
- Host 首先拒绝链接/无效文件，复制 Go 二进制到宿主机私有临时文件、核验安装器 SHA-256，运行其只读 `verify`，再以相同的已验证 Go 可执行文件执行 `install`；Go 安装器内部重新 Snapshot Manifest 指定的组件包并校验全部字节，然后复用原事务安装脚本。
- `--prefetch-only` 只验证，不生成“升级完成”收据；`--backup-file-data` 只传递给真正的 Host 升级事务。CLI 与 UI 的真实更新进度仍由 `server-control.sh` 跟踪；不能在管理页面执行任意 Docker 命令。
- Server API 严格要求管理员认证且校验枚举、ID、两项 SHA；Host Control 再次检查后只将这些值传给 `xdrive-server update --source offline`。缺少信任证明、路径遍历、旧请求或异常状态均先拒绝，绝不回退到未经证明的 Python 或在线下载。

## 下一阶段与门禁

1. 发布脚本必须编译 Linux AMD64 Go ELF 并对**最终 ELF 字节**作 Sigstore/OIDC 证明；签名发布描述符需要同时绑定 Manifest、Go ELF 与不变的组件指纹。不得改写旧的 Python/Manifest Release。
2. Host Control 必须为 Web 上传建立由宿主机拥有、组 65532 可写的独立 `update-imports` 暂存目录。管理页面不能让 Server API 容器获取 Docker Socket 或任意主机路径写权限。Web 分块上传需完整性校验、磁盘配额、续传与删除机制；受控宿主机目录导入只接受 Host 创建的候选 ID。
3. 新 UI 的「系统更新」页要显示候选 Manifest、实际 Server Commit、五组件状态、信任来源、磁盘空间和恢复状态；只有 Host 确认签名/独立摘要后才能启用「安装」，更新前仍需二次确认。
4. 正式合入按依赖顺序：Go 核心 PR #3751 → Host 受限请求/执行器 → UI 接入、发行格式升级。每个 PR 的适用 CI/Final Gate 必须成功；Gen10 实机断网安装、失败回滚和文件一致性另行验收。

## 已知限制

该 Draft 并未配置固定 Host 创建流程、网页上传或自动签名读取。管理员不能仅凭本分支代码就认为网页离线更新已具备可用上传、安装能力。本次实现不改动 PostgreSQL Major 或 DSM SPK 升级路径。


## 4B：Host 本地可信签名优先

新离线 Release 的 Sigstore 验证在宿主机可信的 Bash bootstrap 里执行，绝不依赖被上传的 Go ELF 自证。已配置固定信任根时，Host 从受控离线候选目录读取 `delivery-attestation.jsonl`，通过 `gh attestation verify --bundle --custom-trusted-root` 分别验证 Manifest、`delivery.json`、Go ELF 的私有快照。强制官方 `lazyxu/xdrive` 仓库 ID `1382670236`、指定发行工作流、master 分支和完全一致的 source commit；拒绝 self-hosted runner。验证后 Host 将签名主体的实际 SHA 传给**已经签名认证的 Go ELF**，由 Go `VerifySignedDelivery` 严格解析 `delivery.json`（拒绝重复 JSON 属性和未知字段），核对发布仓库 ID、source commit、Manifest/ELF 的 SHA-256 与大小，并要求 `delivery.json` 完整字节 SHA-256 与 Host 已验签的私有快照一致，再核对正在运行的 Go ELF 字节，再进入五组件校验和事务安装。此时不需要让未认证的程序验明自己的身份。

可信根只能由管理员**带外**配置在 `~/.xd/config/offline-trust/trusted-root.jsonl`，不可从上传包提取，也不能让 Server 容器修改。可在可信的联网设备用 `gh attestation trusted-root` 取得公共根，核对来源并安全传输至 Host；目录权限 `0700`、文件权限 `0600`，所有者应是运行 Host CLI 的用户。Host 需要支持离线证明校验的 `gh` CLI。离线验签无法实时发现可信根取得之后发生的撤销，应通过独立可信流程维护其更新。

**根已配置**：签名、可信根、GitHub 原始仓库 ID、工作流或发布源提交验证失败，均立即拒绝安装，严禁回退手工双 SHA。**根未配置**：继续使用原先双 SHA 独立来源方案，上传时的 transport SHA 或 Manifest 中自报的值不能作为信任依据。此功能不改写老 Python Release，不影响既有 xDrive Share 在线更新。

**边界**：本 PR 实现 CLI/Host 的自动 Sigstore 引导；Server API、Web/Desktop 当前仍要求双 SHA 输入。要让 UI 无需手工输入，需要后续 PR 修改 API、Host Control 和 UI 端到端合同并验证。不可将整个 4B 体验提前记为已完成。

测试：`python3 -m unittest discover -s scripts/offline -p 'test_host_go_sigstore.py'`，后续还需真实 `gh`、可信根和离线 Release 的验收。
