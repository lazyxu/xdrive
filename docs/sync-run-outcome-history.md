# 同步文件夹：运行历史统计与证据契约（P0/P1/P2）

**状态：Implementation + exact-head CI pending。** 设计和 API 语义统一供 Web、Mobile Web 与 Desktop 共享使用，不假装执行了真实手机/PWA 或100k实体性能测试。

## 统计口径及防重复

- **扫描**（`scanned_items`）是已观察到的源项，不等于同步完成；不能再使用 `scanned_items - failed_items` 作为成功。**已同步**显示经 Server 提交确认的 `created_items + updated_items`；纯移动由 `completed_moved_items` 单独显示，已更新中可能包含移动并更新，两者不能求和成总数。
- **未变化** `unchanged_items`：可信 Source identity/path/content 无变化，无须传输。**已忽略** `ignored_items`：命中规则。**跳过合计** `skipped_items=ignored_items+unchanged_items` 是派生汇总而非第三个互斥项；不可加总。
- **失败** `failed_items` 来自 Run 的可复核失败记录和进度，可能包含因未提交而在终态自动识别的项。**已发现未处理** `unprocessed_items` 仅为结束时（非正常完成）本轮 `last_seen_run_id` 所属、仍为 `pending` 且**尚未记录为失败**的项。未开始扫描的远端文件数不知，不能猜测。字段缺失表示旧记录未记录，不能渲染 0。
- **来源修改规划** `new_items / changed_items / moved_items` 是扫描分类；`created_items/updated_items/completed_moved_items` 是提交后的操作结果。扫描模式不计已同步。

## 真实传输与避免传输字节

- `transferred_bytes` 是上传流程已成功提交分片的字节累计，不能声称它严格等于 TCP on-wire（可能还有协议头/重试）。服务端上传会话显式保留 `cas_reused` 位：只在验证该Owner现有 SHA-CAS 复用的 instant finalize 上为 true，冲突策略跳过为 false。客户端不能因为 `transferred_bytes==0` 就判断复用。
- `reused_part_bytes` 来自服务端带 `Reused=true` 的已收到分片（当前来源与目标数据复用）；`resumed_bytes` 来自恢复的此前已收到但非 `Reused` 分片。两者在当前 Run 内对一个文件互斥，校验总数不超过大小。API 只在已确认提交且通过 SHA/Node/Revision 及身份校验后增加一次，重试同提交不会累加。
- `cas_reused_items/bytes` 只统计显式复用的 **已提交文件**；`reused_part_items/bytes` 和 `resumed_items/bytes` 仅统计有相应字节的已提交文件。避免传输的粗略逻辑字节展示为 `unchanged_bytes+cas_reused_bytes+reused_part_bytes+resumed_bytes`，不含 ignored；不同操作类型未去重汇总项目数，不用于网络速度，也不保证所有来源的缓存命中都能被识别。

## 不可变历史快照与失败分类

- `xd_source_run_skips` 在每次观察计划产生 `ignore` 或 `unchanged` 时批量记录 `run_id,external_id,kind,path,size,reason,observed_at`。唯一键 `(run_id,external_id)` + ON CONFLICT DO NOTHING，重复扫描/请求不能重复写数；关联运行作为唯一归属。查询：`GET /api/v1/sources/:id/runs/:runID/skips?limit=20&offset=0&reason=ignore|unchanged`。严格Owner/Run校验，Local Push 仍受设备私有详情权限限制，不泄露设备路径给其他设备。
- 明细最多保留 **30 天**，按现有 Janitor 批清理，与长期保留的 `SyncRun` 聚合计数相互独立。超期、旧历史的逐文件明细明确显示“未记录或已过期”；不能从被后续同步修改的 SourceItem 反推旧时路径。
- 失败 `SourceRunFailure.Category` 按稳定 `rate_limit/permission/source_changed/conflict/network/other` 存储，不把原始错误文本当标签；`failure_categories` 保存该 Run 的不可变分类数量 JSON。现有错误文本仅原先受保护的详情界面可见。列表页和详情只显示已持久化的类别；旧历史缺失类别时不可虚构。
- 失败历史和跳过明细都按Run/Owner分页；多端使用相同共享 DTO/React 组件。旧 Server/Agent 缺字段或不提供 skip 端点时，显示“历史未记录”，不能失败即清空既有聚合计数。
- 镜像删除仍要求两次可靠完整 inventory + 24 小时、完成态和相同 Source revision；本改动不放宽这些不变量。取消只终止**该同步 Run 的已有请求**，用户拥有的持久传输、操作、任务不因页面切换被清理。

## 验收清单

1. Go planner failure classifier：网络、权限、限流、冲突、源文件变化/未知与优先级。
2. HTTP/PG observe 两次：单 Run `ignore/unchanged` 只有各一条原始路径快照，非法 reason 400、错误Owner/Local设备无权、旧 Run 再次同步不污染旧历史。
3. HTTP/PG commit 两次：已确认 create/update/move-update、真实 transferred、CAS 与分片/续传，确保同一事务、幂等，越界/虚假复用拒绝。
4. 取消/partial：已知 pending 且无失败快照的文件单独计数，历史未记录字段保持未知，不能和失败重复。
5. Web/Desktop 共用 `externalSourceRunDetailView` 读旧Run和新Run；计数、旧Run未知、分页/失败分类在宽屏及手机上自适应，Desktop agent/IPC route 与 Web API 相同语义。
6. 只有**精确 HEAD 完整 CI/Final Gate** 和主要PG/API/Go/Desktop/TypeScript 单测通过才能 Ready、Rebase merge，验收后核查相关分支。此次功能没有相同负载 BEFORE/AFTER 的性能收益数字，不冒充专项性能优化。
