# xDrive 备忘录：跨平台 Markdown 文件契约（2026-11-03）

## 已确认范围
「全部功能 → 备忘录」正式入口：Web、PWA、Desktop、DSM、纯原生 iOS、纯原生 Android。两类笔记：「iOS 备份」严格只读（可查看/下载）、「我的备忘录」支持新建、编辑、删除、Markdown 阅读与源编辑、图片插入、搜索、自动保存、版本历史。每个 Server Owner 完全隔离，无多人实时协作、默认无分享；文件页可见。保留移动端既有五模块及模块内导航，DSM 与 Desktop 共用 XDriveApp。

## 统一真实文件目录
Owner 的文件根目录下：
- /@xDrive/@备忘录/iOS备份 — iOS 文本与手动 Markdown/图片导入
- /@xDrive/@备忘录/我的备忘录 — 可编辑 Markdown
- 每个笔记以稳定 xDrive Note ID 组织一个正文 .md 和目录 _assets/<Note ID> 下不可变图片。

真实数据仍通过现有 Node、File、CAS 和 FileVersion 保存，而非容器宿主新建明文目录。目录 ID 必须通过 Server 绑定到 Owner，不能通过同名文件夹擅自获得权限。首次进入时显式初始化，既有冲突目录不自动接管。

普通文件接口可以显示、预览和下载，不能修改、删除、移动、重命名内置目录和里面的内容。保护必须在 Server，对所有普通写路径、UploadSession、批量/异步操作、Undo/Redo、回收站、历史版本、分享上传和同步落盘均成立。自己的笔记只允许走专用 Notes API 编辑，Apple Notes 备份无论通过什么客户端都只读。

## Notes API 与数据语义（后续实施）
稳定 Note 记录绑定 Owner、Note ID、source=ios_notes 或 mine、可验证的外部来源标识（如有）、Node ID、Revision、正文 SHA-256、附件目录。客户端不能擅自改 source。

苹果 Notes 没有第三方读取整个数据库的 API，快捷指令仅导入用户实际提供的文字。不能保证无损读取富文本、图片、表格、附件、锁定笔记；完整 Markdown 和图片采用用户手动导出/导入。若快捷指令未提供稳定 Notes ID，两个同标题源笔记不能被自动合并，标题重命名也不能声称能可靠追踪；缺失稳定 ID 时须保持独立快照或人工映射。

相同来源标识且内容相同：不重复上传。内容变更：保持同一 Note 可见项，旧版本存在 FileVersion。源端删除：不删除云端。任何旧版本仍引用的原始图片不得被回收。手写笔记自动保存以 expected_revision 乐观并发，409 时保留草稿，不能静默覆盖另一个设备。Markdown 渲染净化不安全 HTML，图片仅使用同 Owner 的授权相对资源路径；支持真实容量、读写权限、100k 分页与取消，不能无界加载。

## 交付阶段与当前真实状态
1. Server 目录/Owner 绑定和普通文件保护 PR：**实施中，尚未完成验证**。
2. Server Notes CRUD、来源不可变约束、iOS 增量更新、附件资源和 FileVersion：**未实现**。
3. Web/PWA/Desktop/DSM 公用 Notes 页面及入口：**未实现**。
4. iOS 原生 UI 和快捷指令 PR #3683 改成专用 Notes API 与 .md：**未实现**；PR #3683 当前只负责旧版根目录纯文本快照，不代表此需求完成。
5. Android 原生 Notes 阅读、编辑和入口：**未实现**。

全部变更经 PR 精确 HEAD 的适用 CI、Final Gate、分支保护后才能合入 master。iPhone/Android/DSM 实机行为若缺设备应记作「跳过（未验收）」而非 CI 通过。手机本地备份任务加密日志等非 MVP 增强暂缓。