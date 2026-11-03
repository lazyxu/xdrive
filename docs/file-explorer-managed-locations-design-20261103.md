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
