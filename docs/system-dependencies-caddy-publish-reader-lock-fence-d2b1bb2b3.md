# D2b-1b-b2b3 · Caddy 签名 Bundle 发布期 Reader 锁围栏

2026-10-22。基于 #2302 固定私有 Reader 与仍处于独立 Draft/CI 的 #2313 私有发布器。三个签名文件依次执行单文件原子 Rename，**不是同一原子事务**。

本阶段维持对外 ReadPrivateBundle 原签名不变，强制在打开和验证受信根目录后、返回已验证结果之前，**两次**检查固定 .caddy-running-identity.publish.lock。只有锁文件完全不存在时才允许公开读取；存在持久锁、损坏、符号链接、目录或无法判断都返回同一个脱敏错误。内部发布者已经拥有 O_EXCL 锁，才能通过包内不导出的 readPrivateBundle(..., true) 在撤锁前校验完整文件；它不会开放为 HTTP、管理员操作或采纳权限。

新增 Go 原生锁存在、过期保留、符号链接、目录异常、撤锁后恢复以及私有写者安全自检测试。仍必须由真实签名和新鲜度验证确保证据准确，写锁保护不等于负向入口证明、实时 Caddy 代际与 Live Config 一致或 WAN 可达。

后续尚需可信 Host Collector、独立禁用入口负向验证、固定 Server 私有信任根消费者、D2b-2 单次签名授权和双修订 PostgreSQL CAS、D2b-3 显式确认，以及 #2075 only-Caddy Rescue/watchdog/rollback/签名 Applied Receipt。CandidateComplete/CanAdopt/ApplySupported 继续全部 false。

生产环境专属验收按用户决定跳过（未验收），不索取生产账号、密钥、Cookie/JWT、HAR、抓包或人工签字；真实源码安全、Go+PostgreSQL API Race、跨平台和 Final Gate 不得跳过。
