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
- 目录内必须有 `manifest.json`、`xdrive-offline-linux-amd64`、Manifest 指定的组件包。未来 signed delivery 可额外提供 `delivery.json` 和 attestation。**当前 Draft 尚未完成 GitHub 签名 ELF 自动受信模式；两个从独立可信渠道取得的 SHA-256 均必填。**
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
