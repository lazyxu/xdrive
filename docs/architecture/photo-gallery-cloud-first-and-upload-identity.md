# xDrive Photo Gallery：浏览与上传分离的全平台统一契约（2026-11-07）

> 范围：iOS Native、Android Native、Web/PWA、Desktop、DSM 和已有 Server/Agent。维持当前 Source/Device/Owner/Node、UploadSession/CAS 和权限边界，不创建第二套上传协议。本文件描述目标契约和本 PR 的实现范围；尚未落实的项目不宣称已完成。

## 1. 错误根因与不可妥协的行为

- **查看图库不是备份，不是完整性核验。** 默认首屏绝不能触发整个本机库的 SHA-256，也不能因为本地核验中、权限拒绝、PhotoKit/MediaStore 失败而隐藏已授权的 Owner 云端照片。
- 本机照片可以只通过 PhotoKit/MediaStore 元数据以及按需缩略图显示；云端照片由 Server 的 Owner/Node/PhotoAsset 索引独立分页显示。两个读源独立出错，任一个成功仍可浏览。
- 「两端都有」需要当前设备的受信原件指纹与当前授权 Server 原件一致；不能靠文件名、大小、拍摄日期或历史上传计数推断。
- 「仅云端」是相对于某个 **完整且当前授权的设备图库范围** 的否定结论；无完整库存证明、权限为部分授权或有尚未读取的原件时，只能标为「待核验」，而不是断言「仅云端」。
- 不允许将「不在上传队列」「本地当前不可读」「收据未知 ACK」误报为已备份、已删除或仅云端。
- 列表/缩略图是读操作；严禁触发网络原件下载、UploadSession、CAS 写入、BGTask 或操作系统照片删除。

## 2. 三个方案比较

| 方案 | 浏览速度/设备成本 | 全库变化后的工作 | 证据完整度 | 结论 |
|---|---|---|---|---|
| A. 进入图库时核验全库 SHA-256 | 首次和失效时读取大量原件，可能耗电、占 I/O、受 iCloud 影响 | N 个原件，失效时可大规模重复 | 可证明完整内容相等，但核验期间会造成无意义浏览阻塞 | **不作为默认路径**，仅显式诊断 |
| B. 只在上传时发现文件，并读 SHA-256 | 浏览最快，字节成本只发生在传输需要时 | 仍需轻量枚举、变更发现和中断/删除处理 | 上传内容和服务器回执可靠；未上传内容无法证明两端完全相同 | 可做简单 MVP，但必须保留元数据变更队列 |
| C. 独立轻量变更索引 + 上传时原件哈希与服务器回执 + 按需核验 | 浏览与上传分离；只对变更项/待上传项读取原件 | 已知变更优先，变更历史失效则做 **元数据级** 有界重建 | 云端展示和上传完成可信；未知来源如实待核验 | **推荐的统一架构** |

不引入全平台强制哈希。文件同步同样遵循发现 → 上传前原件读取/哈希 → UploadSession/CAS → Server 真实收据，而不是打开文件列表时对整个目录逐字节比对。

## 3. 一份业务模型，四条独立通路

1. **CloudRead（只读）**：Owner 授权后从 Server 以 48 项（或协议规定范围）分页读取 PhotoAsset/Node；缩略图单独请求和缓存。与本地授权/索引/传输状态无关，任何本地失败不得把云端结果清空。
2. **LocalRead（只读）**：iOS 使用 PhotoKit 的元数据/懒查询；Android 使用 MediaStore 分页。未授权时只屏蔽本机源，不触发浏览层权限弹窗或隐式全库原件访问。
3. **SourceDiscovery（轻量）**：按 Owner+Device+Source+许可范围维护位置/原件修订的元数据队列。iOS 首选 PhotoKit persistent changes；Android API≥30 首选 Volume version + generation，旧系统/变更历史失效时有界重枚举 **元数据**。删除与访问权限变化不可直接推导云端应删除。
4. **OriginalPush（写入）**：同文件同步的 Source 绑定、设备身份、上传会话、CAS/Node 原件及版本。对实际待传原件，安全 staging + SHA-256；重新确认当前照片修订与 Source/Owner；利用当前精确收据跳过重复上传。失联/UNKNOWN_ACK 先只读查询服务器，决不盲目重传。Live Photo 静态/动态两份资源必须一起证明，不能以其中一项成功代表整组成功。

**显式完整核验** 是第五条只读诊断通路，用户主动触发；在后台或退出页面时取消。不承担普通图库列表、自动备份或删除判定的先决条件。

## 4. 统一身份与状态（Server 是远端真相）

- `SourceAsset = (Owner, Device, Source, platformAssetID, observedRevision, mediaKind)`；本机原始 ID 不裸发给其他 Owner。标识符用作用域哈希或本机加密账本，不能跨 Owner 复用。
- `OriginalIdentity = (resource role, byte length, sha256)`；Live 由 still+motion 两份组成；Cloud Node/PhotoAsset 的 `revision` 和 Owner/Root/ACL 必须重新校验。
- `VerifiedReceipt = (SourceAsset revision, OriginalIdentity, UploadSession, Server Node/Revision, confirmedAt)`；只有当前可信收据可声称「本次修订已备份」。
- 状态独立：本地观察 `present/absent/unknown/permissionDenied`、云端读取 `available/unavailable`、上传 `queued/working/verified/uncertain/failed`、内容配对 `matched/unmatched/ambiguous/unverified`。前端不能用单一布尔值代替这些维度。
- UI 对来源筛选保守：`both` 需正向核实；`localOnly` 需服务端针对当前指纹的可信未命中；`cloudOnly` 需全范围本地已检查且没有本地指纹；所有其余组合为 `unverified`。云端来源的普通分页不受这些筛选结果约束。
- 上传成功与云端图库刷新通过 Owner/Node revision 失效通知，不由启动本机整库哈希作为触发器。

## 5. 平台落地

| 平台 | CloudRead | LocalRead / Discovery | OriginalPush | 本轮具体处理 |
|---|---|---|---|---|
| iOS Native | Server 原生云端 Wall/Viewer，独立分页 | PhotoKit 64 槽窗口；变更记录/受权范围只影响本机证据 | 现有加密账本、PhotoKit staged SHA、受管 Source 和 Server 回执 | **修复默认统一图库的隐式整库 SHA**；本机失败不阻断云端；完整 SHA 仅手动诊断 |
| Android Native | 现有 Server Gallery | MediaStore 可取消的按需分页；仅显式日期全库索引 | 现有 staged SHA、VerifiedReceipt SQLite 和不确定 ACK 核对 | 保留已正确分离的两条浏览路径；增加不退化回归测试 |
| Web/PWA | Server 查询和 Owner 缩略图 | 浏览器无设备本机库索引 | 显式选择文件的当前 UploadSession | 无需手机式本机 SHA；加同等行为契约测试 |
| Desktop | 同一 Shared React MediaGallery/Owner API | 桌面 Agent 本机目录 watcher/journal；不得通过 Gallery 扫本地文件 | 现有 Source Manager 和文件 Push | 原代码正确时不额外改动；跨平台合同测试 |
| DSM | 同一 Shared Gallery，Owner/ACL | DSM Agent 目录变更/有界元数据回扫 | Synology 文件夹 Push MVP | 不新增图库原件扫描；维持当前停用的 Synology Photos/Files Pull |
| Server | 权威 Node/PhotoAsset 分页、签名缩略图 | 不推断设备侧不存在 | Source/Device 身份、UploadSession/CAS、幂等收据 | 云端读取绝不查询设备索引/等本机原件；不重复建上传服务 |

## 6. 安全、迁移与验收

- 正常使用场景：冷启动、切 Tab、Viewer 返回、下拉刷新、照片增删改、设备切后台、断网、低电量都不得自动扫描所有原件；**各自展示可读源**；读源缓存按 Owner 和 revision 隔离。
- 没有 PhotoKit 完整权限/MediaStore 只有部分授权时，CloudRead 仍工作；不显示虚假的「仅云端」。
- iCloud-only 原件只能显示授权缩略图；上传由显式允许 iCloud 下载或保留等待任务，不在浏览时下载原件。
- 删除/变更 1 项不应重新哈希剩余 N−1 项；expired/unknown change history 允许重建轻量元数据，但不自行开启字节级核验。
- 不确定 ACK 必须保留日志，通过当前 Owner/UploadSession/Node 只读再确认。
- 图库中来源精确核验可被取消，不能生成备份成功回执、删原件、改变自动备份授权或通过缺失证据偷偷合并重名照片。
- 性能目标：O(可见窗口) 的缩略图与分页；仅上传/显式核验触发字节读取。需要有同数据基线后才能宣称实际速度提升。
- 自动验证：iOS 核验不自动运行、云端不依赖 PhotoKit、可见项未知状态保留、服务端不可用时本机可看；Android/Shared Gallery 原有独立取源不退化；Owner、页锚、未知 ACK 的已验证安全门禁保留。
- **当前 PR 并未新建跨平台 Source API/数据库、统一旧上传协议或完成真机测试**。后续若确需新 Server API，须先完成 Owner/Device/Source 权限、迁移、回滚与 CI 审查；不得把设计说明冒充实现。

## 7. 单 PR 合入策略

沿用 #4037 作为 **唯一最终 PR**。它原本的持久化指纹、增量校验与安全测试适合 **可选的手动诊断**，但只提高扫描效率，不能解决默认 Gallery 读取原件的错误依赖。本轮新增 iOS CloudRead 独立首屏、PhotoKit 失败降级、默认零字节核验及全平台回归测试；原 #4037 的 SHA-256 索引与未完成证明边界继续保留但不由普通图库启动。

当前所有改动在派生开发分支预先整合并审查，最终以 fast-forward 方式更新 **同一个 #4037 PR 分支**。原已测试 HEAD 的结果不用于替代新 HEAD 的 CI；合入 master 必须等待新 HEAD 的所有适用必需检查和 Final Gate 完成成功。
