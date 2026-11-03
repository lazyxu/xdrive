# 文件管理器：Push / Pull / Notes 受管目录与回收站（评审设计）

> **状态：待评审的设计，尚未实施。** 决策时间：2026-11-03；调研基线：GitHub master 3489f8d3b797807e5a1ea9b7c1b9f7915527d752。本 PR 只保存设计，不修改产品代码。批准设计后另起实现 PR，并以准确 HEAD 的 CI 和 Final Gate 作为合入条件。

## 1. 确认的范围和设计决定

本方案只覆盖五个用户可见入口：

1. **设备备份（Push）**。
2. **远程拉取（Pull）**。
3. **我的备忘录**。
4. **iOS 备忘录备份**。
5. **回收站**。

用户已确认的不可变规则：

- 文件管理器**侧边栏新增入口，所有现有文件仍保留原来的物理位置、Node ID、CAS 和归属**。不把 Source 目标重建在新的统一系统目录，也不复制原文件。
- 受同步管理的 Push/Pull 文件**默认只读**；允许预览、下载和**复制到普通目录后编辑**。真正的同步入库继续归原有 Agent / Worker。
- 删除 Source 配置**默认保留云端文件**，清理这些文件是单独操作、单独明确确认；不能通过删除文件夹隐式删除 Source 或设备源文件。
- 我的备忘录可以新建、编辑、删除、恢复。iOS 备忘录备份不能手动新建/编辑/新增，却允许**删除云端备份、恢复、复制为个人备忘录**；不影响 Apple Notes 原件。
- Notes 恢复必须同时恢复 Markdown 正文、Note 元数据、图片附件和版本引用相关状态。
- Owner 可**主动只读分享**受管文件；普通匿名上传、普通 Share 写入不能修改受管文件。iOS 备份默认私有。
- 回收站沿用现有删除/清理机制，**不新增自动到期永久删除**；允许明确确认的手动清空。
- 本文是独立设计 PR；**产品代码等待评审确认，再按 PR 分阶段实施**。

**不在本方案中**：系统/客户端下载包、文件收集箱、保险箱、系统备份快照、系统日志、历史版本单独顶级目录、重新设计同步引擎、单独新建 CAS/Node 模型、全局移动端五模块重排或新设回收站到期策略。最近、收藏、搜索、共享和任务中心维持原有定位，不升级为特殊目录。

## 2. 最新 master 的事实与明确缺口

| 部分 | 已有代码与事实 | 目标与缺口 |
| --- | --- | --- |
| Owner 文件与 Viewer | 真实 Node/File/FileVersion/CAS、FileExplorer、批量 FileOperation 和已有读权限 | 对所有普通/批量/断点上传入口统一执行 Source 受管写入拦截 |
| Push/Pull | Source 有 OwnerID、Direction、TargetNodeID、Revision、SyncMode；SourceItem 有 SourceID、NodeID、NodeRevision、ExternalID；Source Run 有独立生命周期 | 入口发现和按 Node 归属的动作能力；Source 归档时保留内容和历史 |
| Push 本机权限 | local_folder Push 要求拥有设备 Agent 与 Root 授权；其他设备和 Web 只读观察；实施阶段进度不一致 | Files 入口必须完全服从上述限制，不能获得远程 Agent 控制 |
| Pull 与 Mirror | Pull 连接器、源计划器和 Backup/Mirror 模式；Mirror 只在可靠缺失证据下进入 Trash | 只读 Files 视图，不让普通文件修改冒充来源变更 |
| 我的 Notes | NotesNamespace 绑定真实 Node；Note 业务身份、Markdown/CAS、图片 _assets、FileVersion；我的备忘录专属增改删 | 与 Files 入口和业务级 Notes 恢复贯通 |
| iOS Notes | 通过 ios_notes 导入接口加入真实 Node，编辑界面只读；当前 deleteMyNote 拒绝该来源 | **新增用户删除云端 iOS 备份**，仍禁止用户新建、编辑和伪造导入 |
| Trash | 已有 Trash 列表、Node.DeletedAt / TrashRootID、恢复与永久删除 | Notes 元数据和附件的整体恢复；有界、可确认的手动清空 |
| Share | read_only 和 view_upload 是既有模式；Share 令牌和 Owner Token 隔离 | 受管区域**仅显式只读分享**、防祖先 Share 越界和匿名写入 |

**禁止把目标写成现状**：

- 当前通用 Trash 恢复并不会同时恢复已软删的 Note 元数据和附件；对 Notes 受管目标还会拒绝普通 Node 恢复。
- 当前 deleteMyNote 只允许 source=mine，拒绝 ios_notes 的用户删除。未来 iOS 删除必须增加独立授权业务接口，不允许把普通 Notes 写权限扩大到 ios_notes。
- 当前绑定过历史的本机 Push Source 不能通过 DELETE /sources/:id 硬删，否则会级联失去 SourceItem/SyncRun 等历史。这是保护，不应为满足“删除配置”而移除。
- Source.TargetNodeID 可以位于用户早已有的普通目录；不能按显示路径或目录名直接将整个旧目录里的所有 Node 认定为受管。
- 当前 Notes 首次初始化是显式 POST，不是浏览 Files 时偷偷创建目录；用户既有同名目录不能被自动接管。

已有规范：[文件管理器](file-explorer.md)、[统一 FileExplorer Core](unified-file-explorer-core.md)、[设备备份与远程拉取](sync-folder-apps.md)、[Source 架构](external-source-architecture.md)、[同步策略](sync-folder-sync-strategies.md)和[Share 上传](share-upload-session.md)。

## 3. 设计原则与对象模型

### 3.1 三种对象，而不是第二套文件系统

- **导航入口**是固定的 Files UI 入口（push、pull、notes-mine、notes-ios、trash），不拥有任何文件字节；不会生成一个可以重命名、移动或删除的伪 Node。
- **受管 Node**仍是现有 Node + File + CAS，由真实 Note 或 SourceItem 的身份关系决定允许动作；来源连接器和 Notes Writer 仍是唯一业务写入者。
- **回收站虚拟集合**是 Owner 作用域内 Node 删除状态的投影，不是新的目录树或存储根。

首期不建立通用 SpecialLocation 表，不实施覆盖 13 种类型的“大特殊目录框架”。入口从已验证 Owner 的 NotesNamespace、当前可见 Source、Trash 能力按需派生；服务器对每次实际的读写请求重新鉴权。

### 3.2 文件管理器的逻辑结构

~~~text
文件管理器侧边栏
  全部文件               → 现有 Owner 根目录
  设备备份（Push）        → 可见的本机/其他设备 Source
    设备 / Source         → 对应 TargetNodeID
  远程拉取（Pull）        → Owner 可见的 Pull Source
    来源 / Source         → 对应 TargetNodeID
  备忘录
    我的备忘录            → NotesNamespace.MineNodeID
    iOS 备忘录备份        → NotesNamespace.IOSNodeID
  回收站                 → Owner 的 Trash 集合
  [原有最近、收藏、保存搜索与普通目录]
~~~

这只是导航投影。原有 Notes 实体位置仍是 /@xDrive/@备忘录/{我的备忘录,iOS备份}，Source 目标仍是原 TargetNodeID。用户从“全部文件”按照原路径进入同一 Node 时，得到**完全相同的权限**；快捷入口不能成为绕过通用文件写入限制的捷径。

**保持现有应用分工**：Push 的设备注册/Root/调度/运行和 Pull 的连接器凭据/扫描/规则仍在现有“设备备份”“远程拉取”独立管理应用。Files 只增加浏览、定位、只读标记、复制等入口；不再创建一套 Source 配置表单。Synology Photos 同时可能 Push 和 Pull，分类以 Source.Direction 为准，不能只凭 Kind 判定。

### 3.3 兼容平台

- Web、Desktop Electron、DSM 继续使用共享 FileExplorer Grid/Details、Viewer、菜单和请求取消能力；Mobile Web Files 内提供对应“浏览”入口。
- iOS、Android 文件管理是原生 UI，仍调用相同 Owner/Source/Notes/Trash 后端契约；无 WebView 产品 UI。
- 保留手机与平板的全局五模块、52px 全局 Header、模块内部返回历史；侧边栏调整不等于增加顶级 App 模块。
- 导航以 Owner session epoch + entry kind + 可选 SourceID/NodeID 为稳定身份；切账户清理旧行/Viewer/搜索/异步响应，失效 Source 显示不可用，不回退到同名假目录。
- 只有拥有设备 Agent 才能看原始本地路径和做该设备 Source 修改。Web、Mobile Web、其他 Desktop、DSM 不能通过 Files 接口获得设备 Root 秘密或远程控制权。

## 4. 权限架构与矩阵

### 4.1 双层能力，后端最终判定

一层是 **Files 通用权限**：list、preview、download、copy-out、create-child、upload、replace、rename、move、trash、purge、restore、share。另一层是 **业务权限**：Notes.create/edit/delete/restore/duplicate、Source.configure/archive/cleanup、Mirror.reconcile、iOS 受信导入。

前端显示只读，不等于服务器授权；用户有 Notes 编辑资格也不代表能用普通 Node PUT 更新受管 Markdown；拥有 Source 的 Owner 凭据不代表可以冒充设备 Agent 向 Push 上传。

判定至少包括：已验证 Owner、Node 的真实父链/Owner、Source/Note 绑定 ID、Source revision / 运行阶段、设备/Root 授权、Share grant、删除状态及具体业务动作。身份未知、绑定不一致或请求目标未被可靠识别时，**禁止写入**，不得通过路径名猜身份。

### 4.2 最终操作矩阵

符号：允=直接允许；专=必须经专用业务 API；否=禁止；条件=附加校验后允许。

| 动作 | Push 受管项目 | Pull 受管项目 | 我的备忘录 | iOS 备忘录备份 | 回收站 |
| --- | --- | --- | --- | --- | --- |
| 入口创建 | Source 绑定后投影 | Source 绑定后投影 | Notes 显式初始化 | Notes 显式初始化 | 登录后的虚拟入口 |
| 用户新建/上传 | 否 | 否 | 专：Notes 创建/附件 | 否 | 否 |
| 业务加入 | 专：绑定设备 Agent | 专：Pull Worker | 专：Notes Writer | 专：iOS 导入 | 软删除进入 |
| 列表/预览/下载 | 允 | 允 | 允 | 允 | 条件：仍可读取 |
| 用户编辑/覆盖 | 否 | 否 | 专：Notes 编辑 | 否 | 否 |
| 普通 Rename/Move | 否 | 否 | 否 | 否 | 否 |
| 复制到普通文件夹 | 允、脱离 Source | 允、脱离 Source | 专：导出/复制 | 专：复制为我的备忘录 | 专：恢复/业务复制 |
| 用户删除项目 | 否，走 Source 清理 | 否，走 Source 清理 | 专：Notes 删除 | **专：云端备份删除** | 专：永久删除 |
| 用户恢复 | 条件：由 Trash 安全处理 | 条件：由 Trash 安全处理 | 专：完整 Notes 恢复 | 专：完整备份恢复 | 按业务类型路由 |
| 清空内容 | 禁止通用操作 | 禁止通用操作 | 经 Trash 专属清理 | 经 Trash 专属清理 | 允许手动确认清空 |
| 删除入口/受管根 | 否 | 否 | 否 | 否 | 否 |
| Owner 主动只读分享 | 允 | 允 | 允、需 Note 附件授权 | 允、默认私有 | 否 |
| Share 匿名上传/写入 | 否 | 否 | 否 | 否 | 否 |

特别注意：只读是**人类用户对受管原件的普通操作**，不是剥夺真正 Agent/Worker/Notes 导入者的职责。“复制为个人备忘录”和“复制成普通 Markdown”是不同动作，不能把 iOS 备份的 UUID.md 直接搬到 MineNodeID 伪造一个有效 Note。

### 4.3 全部入口都必须拦截

必须覆盖普通 Node 创建、重命名、移动、删除、写覆盖、批量 FileOperation 排队与真正执行、上传 session 初始化/续传/finalize、CAS 秒传、目标选择器、拖放、快捷键、匿名 Share 目录创建/上传/finalize、恢复/永久删除、原有 API 直调。提交事务时必须在真实锁/Revision 下再次检查；只在入队时检查不足以防止 Source 绑定或 Share 权限在排队期间改变。

**通用复制出站**：读受管源、写合法普通目标，生成新 Node 和独立文件修订，无 SourceItem 绑定；可复用验证后的 ContentBlob 引用并正确计算配额。复制到受管目标始终禁止。混合批量选择按原子权限验证或可核实的逐项拒绝，不允许静默跳过却宣称成功。

## 5. Push（设备备份）受管目录

### 创建和加入

1. 继续使用现有 Source 创建/设备 Root 授权和 Source.TargetNodeID 绑定；Files 只是显示这些可见 Source。
2. 只有拥有本机 Root 的 Agent 可以按已授权的 Source Run、原始扫描/分块/commit 协议创建或更新 SourceItem 和 Node。
3. 目标路径可能已有普通文件。受管判定基于 **SourceItem→Node** 与受管根结构性身份，不对所有旧后代“一刀切”变只读。若来源归属不明则阻止新的写入并提示处理，不自动接管。
4. 新 Source 优先使用专属目标子目录；新的重叠/嵌套目标必须预检和拒绝归属歧义；老 Source 保持原位。

### 查看和修改

允许文件列表、原件 Viewer、下载、搜索、复制为普通文件；展示来源名称、设备脱敏标识、Backup/Mirror、最后可靠完成时间。源设备离线时可显示此前已确认的云端文件，但不能显示为已完成最新备份。

禁止用户通过 Files 直接编辑、Rename、Move、Delete 受管文件或目标根；不支持 Web/其他设备管理别人的本机 Root。设置、忽略规则、任务、调度、暂停仅跳“设备备份”并服从现有 owning-device 权限。用户在其它普通文件夹复制出的独立新文件可正常编辑。

### 删除 Source 配置（保留文件）

“移除来源”默认是**归档/解绑**：停止调度与未来写授权、检查并安全终结活动 Run、保留 Source ID 与历史记录、保留 Node/File/FileVersion/CAS。经确认不再被其他活跃 Source 管理的 Node 才转成普通文件供 Owner 编辑。现有历史 Source 禁止硬删除的保护必须保留；**不能**直接调用当前 DELETE /sources/:id 冒充归档成功。

“清理云端备份数据”另作独立、可先预览影响范围和二次确认的持久任务，只对该 Source 独占且 Revision 未变化的节点执行 Trash 软删除，不删除设备原件或别的 Source 内容。其他 CAS/版本引用不受影响。

## 6. Pull（远程拉取）受管目录

### 创建和加入

Owner 仍在“远程拉取”创建连接器 Source，选择授权的来源/目标；Files 入口以 SourceID + Direction=pull 投影。文件只由 Pull Worker 根据提供方身份、SourceItem 和 CAS 校验写入。不允许用户随意上传“伪造远端文件”。

### 查看、修改和复制

Owner 能浏览、下载、预览、搜索、复制为可编辑普通文件。受管 SourceItem 不允许普通 Rename/Move/覆盖/删除；来源配置和作业继续在“远程拉取”中管理。远端更新和移动只能由连接器按其已证实的 ExternalID/Revision 解释，不通过 UI 猜同名文件已重命名。

### 删除/恢复

移除 Pull Source 默认归档并**保留已经下载的原件与历史**，不调用远端 delete；清理本地副本需要单独确认并进入 Trash。Backup 模式保留历史云端文件；Mirror 只能凭可靠的完整扫描/多轮缺失证据软删除，失败/取消/断网不能当成远端删除。

对 Mirror 产生的 Trash 项，**推荐恢复到普通非受管位置**，避免下一次 Mirror 立即把它再判为缺失。恢复回原受管位置必须经过 Source 策略检查和明确许可，不能让通用 Trash 绕过只读规则。

## 7. 我的备忘录：可编辑的受管内容

### 实际路径与身份

保留现有 NotesNamespace：/@xDrive/@备忘录/我的备忘录，使用 Owner 与已绑定 Node ID；不靠名字推导身份。正文 Node 名称是 UUID.md，真正对用户显示的标题来自 Note.Title；正文通过 File/CAS，图片在 _assets/<note-id>/<asset-id> 下，旧 FileVersion 仍可能引用原图片。

### 创建、加入和编辑

- 首次使用由用户明确触发现有 Notes 初始化；GET Files 列表不创建目录，不能自动采用用户既有同名内容。
- 新建必须经 Notes.create 专属业务 API 一次性写入 Note/Node/File/CAS；不通过普通 Files.create 或在受管目录拖放生成任意 .md。
- 用户可改标题、Markdown、经验证的图片引用；保存携带预期 Node Revision（If-Match 或既有预期修订语义），冲突返回 409 而不覆盖较新版本。
- 文件管理器提供列表、Markdown Viewer/编辑器、历史版本、图片、下载/导出；普通 Files 的 Rename/Move/Upload/Replace/BatchDelete 对受管 Note 和附件必须拒绝。
- **导出为普通文件**生成独立 Node；**复制为新个人 Note**须生成新 NoteID 与合法附件映射。不能把被保护的 UUID.md 直接复制/重命名到另一 Note 目录来伪造业务记录。

### 删除、恢复和永久删除

- 当前已有我的 Notes 专属软删除，会让 Note.DeletedAt、正文 Node 以及图片子树进入 Trash；原 CAS 和历史版本仍有引用时不得直接丢失。
- **拟新增完整 Notes.restore**：按 Owner、Note.ID、正文 Node、附件关联及预期修订加锁，核对 NotesNamespace、原位置、CAS 可读性和版本关系。一次事务恢复 Note.DeletedAt、正文 Node.DeletedAt/TrashRootID、该 Note 的 _assets 子树，更新必要搜索索引和 Revision，失败全部回滚。
- **注意不同 TrashRootID**：正文 Node 自身可能是 Trash root，而 _assets/<note-id> 是另一个 Trash root；业务恢复必须按 NoteID 执行同组操作，不能只用通用 trashRestore 恢复正文。
- 碰到同名/业务身份冲突、NotesNamespace 不一致、附件丢失或 CAS 错误时，应返回可诊断冲突并保留删除状态；不得恢复一半或自动改 UUID 文件名。
- Notes 永久删除须由带业务语义的 Purge 操作处理 Note/Node/附件/历史引用；CAS 引用归零并符合原有 GC 条件时才允许物理清除。UI 只显示一条 Notes 逻辑恢复项，不能误把其附件重复作为独立条目清空。

## 8. iOS 备忘录备份：只读、可删除、可复制

### 初始化、导入与查看

- 使用现有 /@xDrive/@备忘录/iOS备份，按 Owner/NotesNamespace/Source=ios_notes 精确定位。
- 内容只接受**受验证的 iOS Shortcuts/备份导入通道**，以稳定 ExternalID 实现幂等；普通 Owner Web/Files/其他设备不得使用通用上传接口向该区域写入。Notes UI 的用户编辑、保存、新建全部拒绝。
- 用户可以列出、预览、下载和查看历史；iOS 备份**默认私有**，只有 Owner 明确选择具体备份时可以只读分享。
- **复制到我的备忘录**通过 Notes 专属 duplicate 动作产生新的可编辑 Note.ID、Node 和附件映射；不可与原 ios_notes ExternalID 共用可写身份，也不构成对 Apple Notes 的回写。

### 用户删除 iOS 云端备份（明确新增能力）

现有 deleteMyNote 拒绝 ios_notes；本方案新增 **deleteIOSBackup**，但只授权原 Owner 删除自己的云端备份：

1. 用户从 iOS 备份详情或 Files 菜单选择“删除云端备份”，明确提示“不影响 iPhone / Apple Notes 中的原件”。
2. 请求携带精确 Note.ID、预期 Revision、Owner 会话；服务端重新验证 Source=ios_notes、已绑定 Markdown Node 和附件关系。
3. 在业务事务中软删除 Note/正文 Node/附件，添加可恢复的来源墓碑，并从 iOS Notes 列表移走；不删除手机/外部源，不永久释放 CAS。
4. **防止立即复活**：后续同一 Owner+ExternalID 的常规重试/导入不自动重建用户已经主动删除的备份，返回可辨识的已抑制状态。用户在 Trash 显式恢复或明确重新允许该备份后，才接收对应身份的新版本。
5. 外部没有可靠 ExternalID 的新导入必须依赖独立幂等请求身份，不能凭标题/路径/大小把两条备份猜成同一条。

恢复仍由 Notes.restore 处理正文、元数据、附件和引用；恢复后继续 Source=ios_notes、只读、原身份。永久清理后应保留最小的禁止自动复活状态而不是原文内容；允许有专属的“重新允许备份”动作，不引入新文件存储。手动删除与停止整个 iOS 同步渠道是两种操作，不能互相替代。

## 9. 回收站：一个虚拟集合，多种业务恢复

### 创建和加入

每个 Owner 自动显示一个逻辑入口，依然根据 Node.DeletedAt 和 TrashRootID 查询；不插入可以删除的真实 Trash 目录。普通 Files 软删除、Notes 业务删除和满足可信缺失条件的 Source Mirror 删除分别产生可恢复项目。用户不得直接上传、创建或移动文件到 Trash。

### 查看

展示可恢复主体及其类型、原位置、删除时间、来源、大小、删除原因/恢复限制。Note 的正文与附件应投影成**同一个业务恢复项**；Source Mirror 条目应显示其 Source 上下文，不泄露本机设备原始路径。保持 Owner 过滤、服务端分页、稳定排序和按需 Viewer；不能一次下载整个 100k 回收站列表。

### 恢复

| 已删除对象 | 恢复途径 | 必要检查 |
| --- | --- | --- |
| 普通 Node/目录 | 复用已有 Trash restore；必要时扩展明确的普通目标选择 | 原 Parent、Owner、同名冲突、Revision、Node/CAS |
| 我的备忘录 | 新 Notes.restore | Note/正文/附件/历史关系同一事务 |
| iOS 备忘录备份 | 新 Notes.restore | 同上，恢复后仍只读，解除明确的导入抑制 |
| Source Mirror 文件 | Source 感知的 Trash restore | 默认恢复到**普通非受管目标**；原 Source 的缺失证据不能再次误删副本 |

原父目录被删除或当前名称冲突时，现有通用 restore 会拒绝。目标方案提供经 Owner 验证的恢复目的地选择；**不得**伪装当前端点已支持这个参数。恢复到受管目录时仍要接受 Source/Notes 的专属权限检查，不允许“先从回收站出来”绕过受管根保护。

### 永久删除与手动清空

- 用户可以按项目永久删除或手动清空全部；不新增“30 天到期自动清除”或其它新的自动保留规则。
- 清空前展示本 Owner 当前可删除的项目数量、总逻辑字节和已知失败风险，要求二次确认；选择快照/确认 ID 防止操作对象悄悄变化。
- 清空由 Server 创建有界、持久、可查询的批处理任务：按普通 Node、Notes、Source 业务类型调用对应 Purge，状态与逐项收据持久化，失败支持单项重试；不要在浏览器循环对 100k 项直接发 DELETE。
- 删除与 CAS/历史版本引用释放必须幂等：同一事务已提交的项目在重试时跳过，仍被 FileVersion 或其他 Node 使用的 Blob 不得物理删除；取消只阻止后续项目，不伪装撤销已永久删除部分。
- 手动清空后应按服务端真实列表刷新；请求失败不能把 UI 渲染为已验证空回收站。断网、浏览器关闭和会话退出只停止观察，不无故取消持久任务。

## 10. 只读分享与写入隔离

1. Owner 可以**主动只读分享**受管 Source 文件和 Note，沿用现有 read_only Share、密码/有效期/撤销/Owner/root 真实子树检查；默认不自动发布 Notes 或 iOS 备份。
2. 任何 view_upload Share 都不能写入受管子树。无论 Share 根目录是否是受管父目录，都要在目录创建、UploadSession 建立、分块重试和 finalize 的实时授权中拒绝：普通匿名上传不能凭祖先共享获得 Notes/Source Writer 权限。
3. **祖先 read_only Share 的读取也要隔离默认私有 Notes**：不能因为以前分享了某个普通父目录，就在以后初始化 NotesNamespace 时自动泄露 iOS 备份。列表/搜索、预览、缩略图、Range、ZIP、签名票据都要检查明确共享范围，不给未授权的 Notes 子树发票据。
4. Notes 的只读分享应绑定具体 Note 身份或精确选定的安全导出，不允许一次性分享整个 /@xDrive。Note 图片须使用受共享对象约束的短期只读附件票据，禁止暴露 Owner 私有 API 图片 URL，也不能浏览另一个 Note 的图片。
5. Source 受管项目的只读分享只包括 Owner 明确选择的 Node/子树及合法派生物；不能授予 Source 配置、更改 Root 或设备指令。被 Trash 删除的文件分享不可继续下载。
6. 通用的 Share capability 只是展示上限，不是一次请求的授权证明。每次 HTTP 请求仍须验证当前 Token、密码、过期、撤销、具体对象及 Owner/Source/Note，Share bearer 永远不能当成 Owner JWT。

## 11. API 合同（目标建议，不是既有端点）

优先复用现有 Nodes、Source、Notes、Trash、Share 的 HTTP/Agent 入口；只有不能表达的业务动作才新增接口。以下**路径只是设计候选**，开发前需与当前真实路由核对，不能据此认为已实现。

| 候选动作 | 使用者 | 效果 |
| --- | --- | --- |
| GET /api/v1/file-explorer/managed-entries | Owner | 无写副作用；发现五个入口、Source 列表及状态、真实 backing Node、只读能力 |
| GET /api/v1/file-explorer/nodes/:id/capabilities | Owner | 当前 Node/业务的动作投影；写入事务仍重新鉴权 |
| POST /api/v1/sources/:id/archive | 有权管理该 Source 的主体 | 停用/归档 Source，保留历史和云端文件；Push 必须经拥有设备授权 |
| POST /api/v1/sources/:id/cleanup/preview | 同上 | 不写数据，展示仅归该 Source 的云端目标和风险 |
| POST /api/v1/sources/:id/cleanup | 同上 | 带确认令牌的持久云端清理任务；只移到 Trash |
| POST /api/v1/notes/:id/duplicate-to-mine | Owner | 独立新个人 Note 和图片映射 |
| DELETE /api/v1/notes/ios-backups/:id | Owner | 带预期 Revision 的云端 iOS 备份软删除，保留导入抑制 |
| POST /api/v1/notes/:id/restore | Owner | 恢复 Note、正文与图片附件 |
| POST /api/v1/trash/empty/preview | Owner | 本 Owner 精确待清理清单摘要和确认 ID |
| POST /api/v1/trash/empty | Owner | 校验确认 ID 后开始持久、可取消的业务分批 Purge |

期望入口投影（示例，不用于授权）：

~~~json
{
  "id": "source:push:42",
  "kind": "source_push",
  "source_id": 42,
  "backing_node_id": 123,
  "display_name": "设备备份",
  "status": "ready",
  "capabilities": {
    "list": true,
    "preview": true,
    "download": true,
    "copy_out": true,
    "generic_write": false,
    "generic_delete": false
  }
}
~~~

ID 必须在当前 Owner/Server 实例下唯一且稳定；不得包含服务端本机原始路径、Share Token、CAS StorageKey、设备令牌、连接器密码。不存在的绑定、设备下线、正在初始化或 Notes 名称冲突返回**诚实状态**，不造假目录。写入和删除使用业务 Revision/If-Match、当前锁与幂等操作 ID，冲突 409、未经授权 403、越权对象不可见 404，并沿用已有配额/容量与错误码惯例。

## 12. 兼容性、事务与状态迁移

### 零搬迁约束

- 本期不迁移 File/CAS、FileVersion、Node ID、Source.TargetNodeID、NotesNamespace 路径和真实文件字节，不制造“同名虚拟目录替换真实路径”的第二份数据。
- 旧收藏、历史、Viewer、地址栏和文件路径继续指向原 Node；无权限的旧版客户端直接请求 API 仍会被服务器拒绝写受管对象。
- Notes 未初始化时显示“需要初始化”，不会在 GET 列表或切换侧边栏时自动创建 @xDrive，也不自动接管已有同名用户目录。
- 已存在的混合 Source 目标、NodeID=NULL 的 SourceItem、重叠来源或不一致附件不能通过猜测名称/路径修复；读可以报告异常，写安全拒绝并提供可审计的处理手段。
- Source Archive 若引入持久状态，需要可回退的 schema/迁移；必须保留历史 Source/Run/Item，不得以硬删除或级联删除替代。

### 一致性与失败回滚

- **Notes 删除/恢复**：以 Owner、NoteID、Revision、Node、附件归属加锁，DB 原子提交；Blob 释放遵循已有持久 CAS 引用与 GC 协议，不能先删物理字节再补数据库。
- **Source 归档/清理**：以 Source Revision、Agent grant、在途 Run 和 NodeRevision 的精确状态为边界；不能在上传进行中解除受管并同时允许普通用户覆盖该 Node。
- **Share 上传**：session 初始化授权不够，finalize 前须按当前 Share、目标父链和管理绑定再次判定；撤销 Share/新增 Source 绑定后不允许旧 session 提交。
- **幂等重试**：超时/未知 ACK 先查询持久收据；不能二次释放 CAS、重复生成新 Note，或将未完成事务记成成功。
- **Source 副本**：复制到普通位置后不继承 SourceItem 管理，后续同步更新不能修改副本；副本修改也不反写设备或远端。
- **回收站中恢复的 Source 项**：不会因下轮 Mirror 再次丢失；历史来源证据仍可核实，原受管目录写入仍受控。
- **浏览器取消**：目录列表、搜索、缩略图和 Viewer 的过时 HTTP 请求立即中止；已开始的 durable 同步/清理任务仅用户显式取消，页面离开不撤销。
