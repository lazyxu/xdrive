# P0-C1f · 设备备份首次概览运行时脱敏校验

## 问题
设备续页、分页运行历史均有运行时 DTO 检查，但共享 Web/Mobile Web/Desktop 组件把首次 `source.list()` 返回的 JSON 直接插入 React 状态。旧 Agent 或异常 Server 可能携带私有 Root 身份、系统路径、原始错误或不完整分页标记。

## 方案
在现有 datasource 身份世代检查之后、首次概览 `setSnapshot` 之前复用 P0-C1e 的严格脱敏校验。初始页没有前置设备游标；续页仍要求有效原始游标和跨页唯一设备 ID。保留服务端的 100 台设备单页上限、设备/同步文件夹/运行记录字段白名单与有效性检查。非法响应绝不标记为空或成功；初次读取走现有失败/重试状态，同账号刷新保留上一份已验证状态，换账号或服务器立即隐藏旧状态。

更新原 P82 挂载 React 测试的假 Server 响应以匹配真实 DTO，并使用真实校验器；增加恶意首屏/刷新和独立单元反例。

## 边界
不引入新的网络调用、Agent IPC、Source/Root 写权限、本机上传 Runner、计划调度、取消、NAS Push 或 Mirror 删除。每设备文件夹分页的嵌套字段加固另立阶段。

本 PR 需其自身完整的源提交 CI：PostgreSQL Go API Race、Go Linux/Windows、Web/Desktop、Rootless、制品、单提交和 Final Gate，并要求合并前 GitHub mergeable_state=clean。没有 Windows/Linux 实装、100k 文件、≥4 GiB 真实备份端到端验收，不应据此启用 Push。