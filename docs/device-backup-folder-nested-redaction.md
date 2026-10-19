# P0-C1g · 每设备同步文件夹分页嵌套脱敏校验

## 缺口
共享 Web/Mobile Web/Desktop `DeviceBackupPage` 已在每设备 `foldersPage` 返回后执行分页游标与顺序校验，再写入 React 状态。但原纯校验器只检验 `source_id/name/status/sync_mode/target_path` 等字段的类型，未拒绝额外的私有文件夹、Root、Agent 字段，亦未验证 `latest_run` 的字段集、归属 ID、时间戳和非负安全整数。旧 Agent 或异常 Server 可将原始 OS 路径、自由错误、Root 标识混入 B-scope 状态。

## 修正
- 不改变已有 0..100 条分页、严格递增 Source ID、前进游标和真实完成页规则。
- 分页顶层只允许 `folders/has_more/next_after_source_id`；文件夹只允许 `source_id/name/target_path/sync_mode/status/latest_run`。
- `latest_run` 与已合入 P0-C1e 的只读安全字段白名单一致，并验证 `source_id` 相等、Run ID、服务器时间戳及全部数值计数。任何意外 JSON 字段或无效嵌套值均失败关闭。
- 继续使用原有同一共享 MUI 校验调用点：在 Agent/Server/账号和请求代际有效性检查之后、写入分页状态之前验收。错误沿原有 catch 保留上一次合法的分页内容，不会假报空列表或完整列表。
- 扩展原 `desktop/tests/device-backup-folder-page-validation.cjs`，覆盖合法完整 Run、路径/Root/忽略规则/原始错误注入、伪 Source ID、非法日期、负数/浮点/溢出计数，以及原有 1003 项游标和前置请求代际保障。

## 不在本 PR
无 Server/REST/Agent IPC 变更；无 Web/异机 Desktop 写操作；不改变本机 Root 授权或 Pull；不启用 local_folder Runner、SourceRun、自动调度、Mirror 删除、NAS Push。并不构成 Windows/Linux 原生 100k 或 ≥4GiB 真实备份验收。

合并前必须通过当前准确提交的完整 PR CI（真正 PostgreSQL Go API Race、Linux/Windows、Web/Desktop、Rootless、制品、单提交与 Final Gate）及最新 GitHub 干净可合并状态；需先妥善完成独立 P0-C1f #2134 的顺序协调。
