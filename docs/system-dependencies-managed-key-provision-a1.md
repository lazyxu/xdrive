# P0-A1 · xDrive 内部服务密钥首次自动托管（Server 私有阶段）

**2026-10-19 · 产品规范 #2130 / 运行时任务 #2131 · 当前改动仅限受信 Server 启动和 PostgreSQL 加密存储，不等于 JSAPI4 生产发布。**

## 目标

- 普通部署者不再生成 xDrive **内部** Ed25519 签名身份或专用会话 Cookie 密钥，也不需要修改源代码、手工执行 OpenSSL 或重新构建镜像。
- Server 首次启动，只有在原有 ConnectorSecrets 根密钥环与 PostgreSQL 可用时，使用操作系统 CSPRNG 创建**实例内部** Ed25519 密钥对与独立随机 Cookie 密钥。经 Keyring AES-GCM 按不同 AAD/用途密文持久化，公开指纹保存在独立的 `xd_internal_service_key_anchors` 表；不会显示或输出私钥。
- 同一 DB 的多个 Server 副本使用 PostgreSQL **transaction-scoped advisory lock** 串行化首次初始化。已有签名身份与 Cookie 密文重新读取、验证而不覆盖；重启、升级、镜像重建正常不重生成。
- 如果缺少原有密文、锚点、不匹配或密钥根不可解密，返回受控失败并仅记录固定脱敏服务日志；由于此能力仍为可选 JSAPI4 前置部分，不能使上传/下载/Pull/图库静态地图不可用。
- 隔离百度供应商 AK：静态 Server AK、动态 Browser AK 以及 HTTPS Origin 原封不动。内部自动密钥只是身份管理，不是百度账户许可，不是外部审核者批准，不是任何合法子资源白名单。

## 安全边界和明确未实现项

1. 当前新独立锚点可以发现 **保留数据库中**签名密文或 Cookie 密文的局部丢失。**数据库整体被清空、回滚到首次初始化之前快照**不能仅凭同一个数据库区分灾难恢复与全新安装。完整生产恢复还需要安全持久的独立 Host/安装器实例锚点，后续工作必须补齐；未验收前不得宣传已完成全部灾难恢复或 P0-A 全部规范。
2. 任何签名材料均不写入现有 `jsapi4PinnedProductionPublicKey`；独立受信 operator release 的根密钥/审批链仍然是另一层信任。JSAPI4 `reviewedJSAPI4ChildResourceCount=0`、真实资源审核和签名安装缺失，实际 `runtime_enabled=false`、地图 Loader/会话仍拒绝。
3. 本 PR 不新增公开 REST/IPC，不开放任何带有私钥的管理员“显示”按钮；“状态、轮换、恢复”管理员合同留给 P0-B，必须独立受审计、修订 CAS、安全过渡/撤销及多副本一致性验收。
4. 现有加密根 `XD_CONNECTOR_SECRET_KEYS` 仍由可信安装器受保护保存。若它缺失或无法解密历史密钥，绝不悄悄自建一个新加密根，避免升级导致既有 AK、来源、会话解密失败。

## 可重复验证

- 原始 Go 无 DB/无 keyring/取消 Context 拒绝。
- 真正 PostgreSQL 独立测试 schema 和两个连接池同时执行八个首次初始化；签名与 Cookie 只有一份，锚点公钥 SHA256 指纹严格匹配，两个密文 AES-GCM。
- 再次启动原密文与修订不变；错误密钥根失败且原有根恢复仍可读取。
- 删除 Cookie 行或删除锚点后，不允许自动补建丢失的部分；静态地图 AK 始终保持；仅内部生成密钥不改变动态地图生产门禁。
- 独立代码 PR 必须准确 HEAD 完整 GitHub 77+ CI，包含真实 PostgreSQL Go API Race、Windows/Linux Web/Desktop、Rootless、构建安装包、single-commit 与 Final Gate，GitHub 当前 clean 才可合并。**尚无真实多机跨区域安装、独立 Host 锚点、密钥轮换、旧版本灰度升级和动态百度授权实测。**
