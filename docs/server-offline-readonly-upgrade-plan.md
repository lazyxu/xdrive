# Go 离线更新：只读候选计划（A05 第一阶段）

命令：`xdrive-offline plan`（**仅在已经认证的 Host Go 执行器中使用**）。管理员的浏览器上传区没有权力运行它，也不应直接执行上传目录里的二进制。

## 操作

```sh
# 示例：受信 Host 已核验实际 Go ELF，并获取独立来源的 Manifest SHA。
xdrive-offline plan --dir /host-private/verified-release \
  --trusted-manifest-sha256 "${INDEPENDENT_MANIFEST_SHA256}" \
  --config-dir "$HOME/.xd"
```

配置了 Host 本地 Sigstore 信任根的交付，必须由可信 Host 先完成三个主体的验签，将 **Host 已证明** 的三份摘要传给同一个已验证 Go ELF，并增加 `--signed-delivery --trusted-installer-sha256 ... --trusted-delivery-sha256 ...`。不能使用传输时客户端上传的 SHA 代替独立信任。

此新操作不调用 Docker、不写磁盘、不开始备份，也不更新运行中服务。它读取可信 Manifest、对本次**选中**的归档执行严格 SHA-256/tar 成员校验，检查 App、成对 AI 组件及现有离线状态记录支持的部分兼容性，输出 JSON。

输出字段：
- `target_source_commit`、`source`、`channel`、`platform`：由已认证 Manifest 派生；`recorded_source_commit` 只有存在已安装离线收据时才显示，明确 `current_version_evidence=previous_offline_install_receipt_not_live_build`，不伪装为 Docker 实际正在运行的版本。
- `components`：五组件分别列出目标包名、SHA-256、指纹、构建提交、选中行为及（若有）上一次离线安装收据。 `recorded_match` 不代表当前镜像仍存在或一致。
- `selected_archive_bytes`、`selected_expanded_bytes`、`minimum_temporary_bytes`：Go 私有快照+解压所需的**字节下限**，不含 Docker 镜像层、数据库备份和文件备份。 `estimated_full_disk_bytes=null` 明示完整占用不可由 Manifest 静态准确预测。
- `trust_basis`：`host_attested_sigstore_delivery` 或 `independently_pinned_manifest_sha256`；`requires_host_verification` 列出仍需要安装时在 Host 独立重验的事项。

## 安装边界与未完成事项

- 此计划只作为只读信息，**不是安装许可**。安装器在备份/维护窗口前仍必须重新验证签名、把候选字节私有快照化，核查实际镜像、配置、容量和完整事务回滚。
- 不缺省复用未验证的 PostgreSQL、Media Worker、AI 模型；缺失依赖需要 Host 实际镜像身份证明。页面中“可升级”的最终判断仍以 Host 实时检查为准。
- 当前 PR **不**增加 Web/Desktop UI 入口或 Host Control 状态回传，避免与正在执行 CI 的 #3811 冲突。后续阶段将这个 JSON 计划接入 Server 管理页面，同时完善实际 Docker 可用空间与五组件当前运行版本。
- 验证：`go test ./internal/offlinebundle ./cmd/xdrive-offline`、适用 Linux/Windows CI、Final Gate。真实 Go ELF 签名、Release、Docker 升级和 Gen10 实机仍需独立验收。
