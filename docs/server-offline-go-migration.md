# xDrive 离线升级：Go 优先迁移与发行兼容契约

> 2026-11-03 用户决策：`xdrive-offline.py` 的服务端运行时职责能使用 Go 的尽量使用 Go；CLI 与管理页面必须调用同一个宿主机更新事务。此文区分已提交源码、待接入发布和实机验收，不把未发布代码称为可安装版本。

## 1. 范围与实现边界

- **Go 源码**：`internal/offlinebundle` 负责 Manifest schema 1/2、受信 SHA-256、五组件 tar.gz 内容/路径/类型、Docker classic 与 OCI 镜像摘要链、兼容性约束、镜像载入、组件安装计划、成功收据。工具入口为 `cmd/xdrive-offline`。
- **已验证事务**：Go 从 App 包提取**哈希覆盖**的 `xdrive-server-install.sh`，调用原升级前备份、维护窗口、健康检查、回滚执行器；不得绕过 `install.lock` 或自动恢复旧数据库覆盖用户数据。
- **单一执行链**：`xdrive-server update`、Host Control 以及 Web/Desktop 系统更新页仅选择来源/目标/经校验导入 ID。实际安装走同一个 Host 管理器/Go 核心。API Server 无 Docker Socket，Renderer 无任意宿主机文件路径/命令代理。
- **受信发布**：Go 可执行文件在 GitHub Actions 使用 Go 1.25 交叉编译为静态 Linux AMD64 ELF；宿主机不需要 Go toolchain。签名必须覆盖**最终 ELF 字节**，不是 Go 源码或名称。不得接受从同一未受信 USB/网页上传中携带的哈希作为独立信任。
- **不兼容目标**：DSM SPK、iOS IPA、Android APK、Desktop 安装包不属于 Server 五组件离线更新；PostgreSQL 大版本升级须独立方案。

## 2. 迁移步骤与安全门禁

| 阶段 | 行为 | 必须通过后才继续 |
| --- | --- | --- |
| G0 Go 核心 | 实现 list/verify/install 与 Docker/OCI 识别 | Go 单元及整合测试、gofmt、go vet、构建 |
| G1 双工具发行 | 在**新的**离线 Manifest Release 同时发布 Python 兼容工具和 Go ELF，分别记录不可变 SHA-256、GitHub OIDC / Sigstore attestation | 原 Python 发布、Share 读取、首次安装回归不下降；Go ELF 有独立受信摘要 |
| G2 发布描述符 | 新版可签名 `delivery` 增加 Go 工具文件记录。旧 schema 1 依然只使用旧受信 Python | 严格格式协商；签名不匹配时**不得**降级到其它工具 |
| G3 Host CLI 与 UI | 新发布默认执行受信 Go ELF，两个导入来源共享组件缓存与相同事务/状态；旧受信发布按其原始 installer identity 兼容 | 完整五组件/仅 App/重用依赖/AI 成对安装，CLI/UI 等价 |
| G4 弃用旧运行时 | 在确认旧受信发布与回滚仍可恢复后，停止对新包发布 Python installer | 版本迁移窗口、真实断网部署、失败回滚/恢复证据 |

**关键**：从旧 Python 切换 Go 不是重命名 `xdrive-offline.py`。旧 `delivery.json` 的 `installer.name` 指定的是 Python 文件；更换内容和哈希就改变受信发布身份。旧 tag 与旧文件**永久不改写**。如果新包同时包含两个工具，需给 ELF 独立名字和新的签名记录；签名失败不能悄悄执行 Python 或改为只检查 SHA。

## 3. 镜像一致性

Go 校验必须继续满足 PR #3693 的约束：
- 不按 `docker image inspect .Id` 直接判断归档不匹配；允许 Docker classic config digest 或与 **同一签名 image ref** 关联的 OCI Manifest/Index descriptor。
- tar 流式哈希、数量/内存/解压限额、拒绝软链接/硬链接与路径遍历；拒绝未签名镜像引用、重名或循环 OCI descriptor、冲突平台/层/标签。
- Docker load 之前完成归档完整性、来源与目标平台校验，load 之后核对实际返回的 Docker identity。
- 不得因为 `imported Docker image identity mismatch` 或其它校验失败而尝试其它未经授权来源。

## 4. CLI/UI 离线导入的一致性

- 浏览器分块上传与 Host 受控目录导入共同指向 `state/update-imports/<32-byte-hex-id>` 下完成的**不可变**候选版本，上传期间绝不执行脚本。
- Host 只接受服务端鉴权生成的导入 ID 与固定枚举参数，不接受 Renderer 提供的可执行文件/容器命令/任意路径。必须在锁与时效检查后重新 hash 已验证文件。
- 优先使用本机配置的固定 Go/Sigstore verifier 与可信根自动校验；没有受信根时，只能由管理员提供来自独立渠道的 Manifest 和 Go 工具 SHA-256。
- 选择需要安装的组件由 Manifest、启用的 Compose profile、已有镜像与已安装指纹推导；App 必选、AI Runtime/Models 同装；无法证明旧可选依赖兼容时拒绝。
- 服务端离线更新被中断后显示真实失败/恢复状态，不自动重放不可逆 Host 操作。

## 5. 验收分层

- **静态/单测**：Go 编译、gofmt、Manifest 受信、大小与 member 哈希、路径欺骗、符号链接、OCI descriptor 与 RootFS 一致性、Docker ID 差异、Go 成功/失败状态。
- **CI 端到端**：真正离线五组件产物完整签名、Go/Python 同一 Manifest 验证结果、受控 Docker Store classic/containerd 各一次、恢复锁、App-only 与启用可选 profile。
- **实机**：Gen10 离线导入、更新及回滚、恢复后 Server/Postgres 健康、旧 Source/共享/文件完整性与配置；未执行之前状态始终标注「未验收」。

当前 Go Draft PR 只完成 **G0 的代码草案**，还没有替换生产发行；G1/G2/G3 应在 G0 验证之后独立检查再接入。