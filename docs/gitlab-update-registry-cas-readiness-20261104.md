# 2026-11-04 · GitLab Snapshot 升级事故与修复

这次 gen10 的一次 GitLab master 升级经历了五个独立故障，逐项处理后用户报告最终升级成功。服务器实测成功不等于本 PR 当前 HEAD 已通过 CI。

| 顺序 | 现象 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | Stage 4: `container_registry_image_prefix` 缺失 | Host CLI 下载未渲染的 `raw/master/deploy/install-server.sh`，没有发布时烘焙的 Registry 地址或资产哈希 | Host CLI 解析 GitLab Snapshot 发布 Commit，按不可变 `sha-<full-commit>` Generic Package 获取安装器和 `SHA256SUMS.txt`，校验 Commit/来源/嵌入哈希后执行 |
| 2 | Stage 5: Docker 访问公网 `:5050` 超时 | Gen10 NAT 不支持公网域名回环 | 保留之前已经配置的本机 HTTP Registry 地址，后续同来源升级不覆盖 `XD_IMAGE_REGISTRY` |
| 3 | Registry 可达，但 JWT `gitlab.t-fluid.com:1080` 超时 | Registry 的 `WWW-Authenticate` realm 是独立域名，仍解析公网 | gen10 的本机 hosts 映射已经完成；发布代码不自动更改 hosts/Docker 全局 TLS 设置，要求 JWT realm 另行可达 |
| 4 | Stage 5: backup verifier 报一个零字节 CAS orphan | Readiness 创建 `.xdrive-cas-lifecycle-locks/.xdrive-ready-<32 lowercase hex>`；异常中断时遗留探针，Verify 只忽略存储根目录探针 | 严格忽略根目录及 CAS/LocalPush 生命周期锁目录中的真实 0/1 字节随机探针；其它孤儿、非法名字和非零/非预期大小仍报告 |
| 5 | 部署资源进度显示 `11/9`、`12/9` | 将 9 个安装阶段误用作文件总数 | 共用部署脚本清单，动态计算下载资源总数 |

## 宿主工具和无阻塞告警

- gen10 没有 `jq` 与 `sudo`：它们不是 `xdrive-server update` 的运行前提。GitLab Release JSON 由已有 Python 3 解析；不安装额外系统包。
- `Host Control needs Server GID 65532 (directory 2770, observations 0660)` 是独立的权限告警，不是本次 Registry/备份失败原因。仅检查固定 `~/.xd/state/control` 目录及其已知观察文件，禁止递归修改整个 `~/.xd`，并在修复后运行 `xdrive-server doctor`。
- 用户操作时曾观察到 `https://127.0.0.1:5050/v2/` TLS wrong version；确认实际使用本地 HTTP Registry，不应通过关闭所有 Registry 的 TLS 验证处理。

## 安全边界

- GitLab Snapshot 只执行已发布 Commit 的完整安装器，不允许校验失败回退到未验证 raw 模板。
- 完整性校验为同一 GitLab 不可变 Generic Package 中的 SHA-256；**并非 GitHub Sigstore 式独立签名认证**，不得如此表述。
- `XD_IMAGE_REGISTRY` 是当前主机的来源专属传输设置：同来源复用，切换来源不继承；离线内容寻址安装器仍以自身不可变 Release 为准。
- 不默认开启 Docker insecure registries、关闭 TLS 证书验证，或从进程中静默更改 `/etc/hosts`。本机 HTTP loopback Registry 不意味着公开 HTTP Registry 可以安全复用。
- 不跳过备份、一致性校验，也不删除 `.xdrive-cas-lifecycle-locks/*.lock` 文件；这些锁的 inode 是跨进程协调的一部分。

## 回归范围

- `scripts/test-xdrive-server-host.sh`：按 Commit 的包 URL，正确项目的局域网优先及公网回退、错误项目拒绝、坏或缺失 SHA 和发布 Commit 拒绝执行。
- `scripts/test-update-channels.sh`：同 GitLab 来源已保存的 `127.0.0.1:5050/... ` 地址不被新发布安装器覆盖。
- `scripts/test-server-installer-bootstrap.sh`：下载资源 `1/12` 到 `12/12`，九个主阶段不变。
- `internal/maintenance/verify_test.go`：三类真实探针可忽略，超长/非十六进制/大小超界/嵌套目录和普通 orphan 仍必须被检出。

## 用户主机的下一次更新

已成功升级并写入 GitLab 来源与本地 Registry 配置的 gen10，可直接执行：

```bash
~/.xd/bin/xdrive-server update
```

必要条件：GitLab Snapshot 完整发布；本机 Registry 和独立 JWT auth realm 都可达，且之前持久化的主机设置未被改变。

新版本 GitLab CI 发布/主机原地升级/回滚的物理验收：**跳过（未验收）**，必须在新版本发布后复测。
