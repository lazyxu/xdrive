# D2b-1b-b2b2 · 只读签名身份 Bundle 的受限私有发布

2026-10-21。依赖 #2298 已合并签名协议、#2302 已合并固定私有 Reader、#2308 已合并包内签名器和 #2311 正在验收的真实本机正向 TLS/Ready 观测。

## 真实提交范围

internal/caddyhostidentity/private_publish.go 实现**包内不导出**、不持有私钥的私有 Bundle 发布器，仅接受经过 VerifyReadOnly 再次验证的、规范化且当前未过期的签名 JSON+LF、64 字节 Ed25519 detached 签名和 44 字节 SPKI DER。所有 Key/Host/Server SHA pins 必须独立受信传入。它不会生成、读取或记录 Host 私钥。

仅在绝对规范、根目录本身非符号链接且无 group-write/world-access 的受信目录中运行。使用 Go 1.25 os.OpenRoot 绑定根目录 inode 和权限，固定三个文件名（Manifest / Signature / Public DER），拒绝已有 symlink、非规则文件和权限不安全的目的文件。使用创建即独占的持久 lock 文件避免多进程并发；锁从非正常退出中残留时拒绝自动覆盖。每个文件以随机 O_EXCL 临时文件创建、0640 权限、Sync、Rename；全部完成后 fsync 根目录并使用现有严格 Reader 验证最终内容，最后撤锁并 fsync。

**必须明确**：三文件按顺序原子替换，**整个三文件集合不是一个原子事务**。中途读取必须依靠严格签名/时效验证 fail closed；失败时会保留锁用于可信 Operator 手动恢复。此阶段不允许浏览器或 Server API 调用该发布器，不连接生产 Caddy，不导出私钥，也不提供新的 Host 应用权限。

## 测试与后续

源码级测试覆盖正确写入、合法复次写入、原签名错误/独立 Pin 错误/格式错误的写入前拒绝、危险根目录、stale lock、已有 symlink/不安全权限、Reader 重新验证和 Windows fail closed。全量 Go/Linux/Windows、PostgreSQL API Race、Web/Desktop、Host Rootless、制品及 Final Gate 均必须按本 PR HEAD 通过。

下一阶段还必须实现**真正独立可信 Host Observer/Publisher**：固定原 Host generation 和 Live Config、完整启用入口正向与禁用入口负向可复核验证、受信私钥 Host 侧隔离及受限 Server Consumer。之后才能实现一次性 nonce 采纳、PostgreSQL 双修订 CAS、Caddy-only Apply/Rescue/watchdog/rollback/签名 Applied Receipt。

当前仍 CandidateComplete=false、CanAdopt=false、ApplySupported=false。生产安全验收**按用户决定跳过（未验收）**，代码级隔离/签名/权限/CI 不得跳过。
