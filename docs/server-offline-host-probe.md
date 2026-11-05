# 离线升级只读 Host 环境预检（A05 第二阶段）

基于已合入 master 的 [Go 静态升级计划 PR #3863](https://github.com/lazyxu/xdrive/pull/3863)，本阶段只增加只读 Docker/磁盘探测和 Host CLI 入口，不触碰 #3811 的 Web/Desktop 签名模式或 #3856 的暂存包清理。

## 新增操作

```sh
xdrive-offline plan --dir /host-private/verified-release \
  --trusted-manifest-sha256 "$MANIFEST_SHA256_FROM_INDEPENDENT_SOURCE" \
  --config-dir "$HOME/.xd" --probe-host
```

前提：此命令只能在可信 Host 上，通过已验证的 Go ELF 执行，Manifest 摘要必须来自独立信任渠道；使用签名 Release 时仍通过原本的 Host Sigstore 三主体认证后传入已认证 digest。没有独立 Manifest SHA、未通过签名验证、或使用上传区自报摘要，都不能成为安装依据。

- 静态升级计划维持 JSON，`--probe-host` 显式开启只读的 `host_probe` 字段。默认不调用 Docker，离线归档检查仍可独立运行。
- Docker：仅执行 `docker info`、`docker container inspect`、`docker image inspect`，不执行 pull/load/build/start，不进入维护窗口。返回实际 Server 容器 Image Ref/ID，但**不能把容器标签当作真实 BuildInfo**。
- App-only 或不携带 PostgreSQL 包时：用当前 Docker inspect 的镜像 ID 与受信 Manifest 的 `postgres` 镜像 ID 精确比较；缺失或不一致标为 blocker。
- Media Worker / AI 图像模型组合：若已有启用的 Compose profile 且本次不携带相应组件，只检查可重用镜像是否存在；由于既有收据并不提供完整镜像身份链，结果明确标注为 `present_identity_not_established`，仍需要 Host 完整兼容性验证。
- 空间：读取当前临时工作目录（默认 `os.TempDir()`）和 Docker 数据根目录的实际剩余容量；将前者与 Manifest 推算的私有快照+展开字节**下限**比较。若无法读取空间或 Docker 不可用，报告阻塞；Docker 镜像层、数据库与文件备份的完整空间需求依旧未知，绝不冒充可安全升级。
- `host_probe.blockers` 和 `remaining_host_checks` 是当前发现和待执行的清单，不是“已批准安装”。更新时仍须重新验签、隔离候选字节、创建备份、健康检查和回滚。

## Host Control 同一可信入口（只读）

在 xDrive Host CLI 上，优先通过现有的固定 import ID 和同一安装器认证链预览，而不是直接运行上传目录里的可执行文件：

```sh
xdrive-server update --source offline --channel master \
  --offline-id 0123456789abcdef0123456789abcdef \
  --plan-only
```

- 上例只适用于管理员已在 Host 配置离线 Sigstore 可信根的情况。无可信根时，还必须提供来自**独立可信渠道**的 `--trusted-manifest-sha256` 和 `--trusted-installer-sha256`，不能把上传回执当作授权。
- Host 仍复制并验证 Go ELF、三主体签名（有可信根时）及准确字节；调用已验证的 ELF `plan --probe-host`，把 JSON 原样输出。签名验证提示写入 stderr，避免污染 stdout 的 JSON。
- `--plan-only` 不可与 `--prefetch-only`、`--backup-file-data` 混用，也不可用于 GitHub/GitLab/xDrive Share 在线来源。不会执行 `install`、下载新脚本或将一次预览写为成功更新审计。
- Host 会产生用于可信引导的私有临时 Go ELF，使用后清除；“只读”仅指不修改正在运行的服务、数据库、Docker 镜像或安装收据。

## 隔离与验收

#3863 已经合入 master。本 PR 必须基于当前 master 重新验证；CI/Final Gate 通过前仍保持 Draft，不声称完成真实 Docker、Gen10、五组件签名发布、备份/回滚或容量实测。

- Go Linux 测试用只允许 Docker 只读子命令的假 Docker 检验缓存身份匹配、缺失、镜像 ID 不一致、临时空间不足、Docker 不可用、Compose 已启用的可选镜像及错误组件组合。
- Go Windows 使用 `!linux` 容量探测桩编译，不在 Windows 伪造 Linux Host 状态。
- 本 PR 不增加新的 Web/Desktop 按钮或 Host API。真实 Docker、Gen10、五组件签名发布、备份/回滚及容量实测仍未验收。
